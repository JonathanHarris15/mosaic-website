/**
 * Reading and writing the Resources library for the MCP (MS-693, ADR-0083).
 *
 * ⚠ EVERY DECISION IS resources-core.js's, and the folder walks are
 * filing-core.js's. This file does Firestore and Cloud Storage and nothing
 * else: it loads records, hands them to the shared cores, and stores what
 * comes back. Those are the same files the browser loads, so a shelf an
 * assistant tidies and a shelf a person drags around end up the same shape.
 *
 * ⚠ NOTHING HERE CHECKS RANK. The gate is in mcp-resource-tools.js, applied
 * once, for the reason mcp-printable-tools.js gives: a per-function check is
 * a check somebody forgets. These calls write through firebase-admin and so
 * never meet firestore.rules or storage.rules at all.
 */

const Core = require("./shared/resources-core.js");
const Filing = require("./shared/filing-core.js");
const Firestore = require("./mcp-firestore.js");

const RESOURCES = "resources";
const FOLDERS = "resource_folders";

/**
 * A refusal an assistant can act on, thrown for the tool wrapper to catch.
 * @param {string} message why not
 */
function fail(message) {
  throw new Error(message);
}

/**
 * What every write leaves behind: when, and who asked for it.
 * @param {?object} actor the caller, from Actor.requireActor
 * @return {object} the fields to merge onto the record
 */
function stamp(actor) {
  return {
    updatedAt: Firestore.now(),
    updatedByName: (actor && actor.name) || "An assistant",
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * Every folder and every resource, as plain objects.
 * @param {object} db the Firestore handle
 * @return {Promise<{folders: Array<object>, resources: Array<object>}>} both
 */
async function loadAll(db) {
  const [folders, resources] = await Promise.all([
    db.collection(FOLDERS).get(),
    db.collection(RESOURCES).get(),
  ]);
  return {
    folders: folders.docs.map(
        (d) => Object.assign({id: d.id, isFolder: true}, d.data())),
    resources: resources.docs.map((d) => Object.assign({id: d.id}, d.data())),
  };
}

/**
 * One resource or one folder, or a refusal naming the id.
 * @param {object} db the Firestore handle
 * @param {string} id the record's id
 * @param {boolean} isFolder which collection to look in
 * @return {Promise<object>} the record
 */
async function loadOne(db, id, isFolder) {
  if (!id) fail("No resource was named. Call resource_list first.");
  const doc = await db.collection(isFolder ? FOLDERS : RESOURCES)
      .doc(String(id)).get();
  if (!doc.exists) {
    fail(`Nothing in the library has the id "${id}". It may have been ` +
      "deleted; call resource_list to see what is there.");
  }
  return Object.assign({id: doc.id, isFolder: !!isFolder}, doc.data());
}

/**
 * Find a record by id without being told which collection it is in — which
 * is what an assistant holding one id out of a listing actually has.
 * @param {object} db the Firestore handle
 * @param {string} id the record's id
 * @return {Promise<object>} the record, with isFolder set
 */
async function loadEither(db, id) {
  if (!id) fail("No resource was named. Call resource_list first.");
  const [asResource, asFolder] = await Promise.all([
    db.collection(RESOURCES).doc(String(id)).get(),
    db.collection(FOLDERS).doc(String(id)).get(),
  ]);
  if (asResource.exists) {
    return Object.assign({id: asResource.id, isFolder: false},
        asResource.data());
  }
  if (asFolder.exists) {
    return Object.assign({id: asFolder.id, isFolder: true}, asFolder.data());
  }
  return fail(`Nothing in the library has the id "${id}". It may have been ` +
    "deleted; call resource_list to see what is there.");
}

/**
 * How one row reads, said the same way the page says it.
 * @param {object} item a folder or a resource
 * @param {Array<object>} folders every folder
 * @return {object} the row
 */
function describe(item, folders) {
  const isFolder = !!item.isFolder;
  const where = Filing.breadcrumbFor(
      folders, isFolder ? item.parentId : item.folderId);
  return {
    id: item.id,
    name: item.name || "Untitled",
    kind: isFolder ? "folder" : (item.kind || Core.KIND_FILE),
    meta: Core.metaFor(item),
    folderId: isFolder ? (item.parentId || null) : (item.folderId || null),
    path: where.length ? where.map((c) => c.name).join(" / ") : "All resources",
    pinned: Core.isPinned(item),
    pinRank: Core.isPinned(item) ? item.pinRank : null,
    url: isFolder ? null : (item.url || null),
    size: isFolder ? null : (Number(item.size) || 0),
  };
}

/**
 * The shelf: folders, resources, and what is pinned to the top of it.
 *
 * A `folderId` narrows it to one folder's direct contents; a `search` looks
 * across the whole library, because somebody who knows the name usually does
 * not know the folder.
 *
 * @param {object} db the Firestore handle
 * @param {object} args {folderId, search}
 * @return {Promise<object>} the listing
 */
async function list(db, args) {
  const a = args || {};
  const {folders, resources} = await loadAll(db);
  const term = String(a.search || "").trim();

  let shownFolders;
  let shownResources;
  if (term) {
    shownFolders = folders.filter((f) => Core.matchesSearch(f, term));
    shownResources = resources.filter((r) => Core.matchesSearch(r, term));
  } else {
    const where = a.folderId || null;
    shownFolders = Filing.childFolders(folders, where);
    shownResources = Filing.itemsIn(resources, where, folders);
  }

  const byName = (x, y) => String(x.name || "").localeCompare(String(y.name));
  return {
    folderId: term ? null : (a.folderId || null),
    searched: term || null,
    pinned: Core.pinnedOrder(folders.concat(resources))
        .map((p) => describe(p, folders)),
    folders: shownFolders.slice().sort(byName).map((f) => describe(f, folders)),
    resources: shownResources.slice().sort(byName)
        .map((r) => describe(r, folders)),
  };
}

// ── Putting something on the shelf ─────────────────────────────────────────

/**
 * The bytes of one upload, from a URL or from base64, refused if too large.
 *
 * ⚠ THE SIZE IS CHECKED AFTER THE BYTES ARE IN HAND, not from a header. A
 * Content-Length is whatever the other end said, and the cap exists to bound
 * what lands in the church's bucket rather than what a server claimed.
 *
 * @param {object} a {url, base64}
 * @return {Promise<{bytes: Buffer, contentType: ?string}>} the file
 */
async function fetchBytes(a) {
  if (a.base64) {
    const bytes = Buffer.from(String(a.base64), "base64");
    if (!bytes.length) fail("That base64 decoded to nothing.");
    return {bytes, contentType: a.contentType || null};
  }
  if (!a.url) {
    fail("Give either url (to fetch) or base64 (the file itself).");
  }
  const check = Core.validateLinkUrl(a.url);
  if (!check.ok) fail(check.error);

  const response = await fetch(check.url);
  if (!response.ok) {
    fail(`That link answered ${response.status}, so there was nothing to ` +
      "upload.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) fail("That link returned an empty file.");
  return {
    bytes,
    contentType: a.contentType || response.headers.get("content-type") || null,
  };
}

/**
 * The last segment of a URL's path, which is the file name often enough to
 * be worth offering when nobody said what to call it.
 * @param {string} url the link
 * @return {string} a name
 */
function nameFromUrl(url) {
  try {
    const path = new URL(String(url)).pathname;
    const last = path.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || "") || "Uploaded file";
  } catch (e) {
    return "Uploaded file";
  }
}

/**
 * Put a file on the shelf: fetch or decode it, store the bytes, write the
 * record. The record is reserved first so the bytes have an id to live under.
 *
 * @param {object} db the Firestore handle
 * @param {object} bucket the Cloud Storage bucket
 * @param {object} args {name, url, base64, contentType, folderId}
 * @param {object} actor the caller
 * @return {Promise<object>} the record
 */
async function upload(db, bucket, args, actor) {
  const a = args || {};
  if (!bucket) {
    fail("No Storage bucket is wired to this server, so nothing can be " +
      "uploaded. Add a link instead, or ask an admin.");
  }
  const {bytes, contentType} = await fetchBytes(a);

  const name = Core.normaliseName(a.name || nameFromUrl(a.url));
  const check = Core.validateUploadFile({name, size: bytes.length});
  if (!check.ok) fail(check.error);

  const ref = db.collection(RESOURCES).doc();
  const storagePath = Core.storagePathFor(ref.id, name);

  // ⚠ NO DOWNLOAD TOKEN IS MINTED HERE AND NONE MAY BE (ADR-0046). The
  // record keeps the PATH; every reader fetches with their own credentials
  // and storage.rules is consulted each time.
  await bucket.file(storagePath).save(bytes, {
    contentType: contentType || "application/octet-stream",
    resumable: false,
  });

  const record = Core.buildFileResource({
    name,
    folderId: a.folderId || null,
    storagePath,
    contentType: contentType || null,
    size: bytes.length,
  });
  await ref.set(Object.assign(record, {
    createdAt: Firestore.now(),
    createdByName: (actor && actor.name) || "An assistant",
  }, stamp(actor)));

  const {folders} = await loadAll(db);
  return describe(Object.assign({id: ref.id}, record), folders);
}

/**
 * Put a link on the shelf — a Google Doc, usually. A link is a link and never
 * a copy: the church edits the Doc where it lives (ADR-0083).
 *
 * @param {object} db the Firestore handle
 * @param {object} args {name, url, folderId}
 * @param {object} actor the caller
 * @return {Promise<object>} the record
 */
async function addLink(db, args, actor) {
  const a = args || {};
  const check = Core.validateLinkUrl(a.url);
  if (!check.ok) fail(check.error);

  const record = Core.buildLinkResource({
    name: a.name || nameFromUrl(check.url),
    folderId: a.folderId || null,
    url: check.url,
  });
  const ref = await db.collection(RESOURCES).add(Object.assign(record, {
    createdAt: Firestore.now(),
    createdByName: (actor && actor.name) || "An assistant",
  }, stamp(actor)));

  const {folders} = await loadAll(db);
  return describe(Object.assign({id: ref.id}, record), folders);
}

/**
 * Make a folder.
 * @param {object} db the Firestore handle
 * @param {object} args {name, parentId}
 * @param {object} actor the caller
 * @return {Promise<object>} the folder
 */
async function createFolder(db, args, actor) {
  const a = args || {};
  const record = Core.buildFolder({name: a.name, parentId: a.parentId || null});
  const ref = await db.collection(FOLDERS).add(Object.assign(record, {
    createdAt: Firestore.now(),
    createdByName: (actor && actor.name) || "An assistant",
  }));
  const {folders} = await loadAll(db);
  return describe(Object.assign({id: ref.id, isFolder: true}, record), folders);
}

// ── Changing one ───────────────────────────────────────────────────────────

/**
 * Rename a resource or a folder. The bytes do not move: a record's
 * storagePath is the truth and nothing recomputes it from the name.
 * @param {object} db the Firestore handle
 * @param {object} args {resourceId, name}
 * @param {object} actor the caller
 * @return {Promise<object>} the record
 */
async function rename(db, args, actor) {
  const a = args || {};
  const item = await loadEither(db, a.resourceId);
  const name = item.isFolder ?
    Filing.normaliseFolderName(a.name) : Core.normaliseName(a.name);
  await db.collection(item.isFolder ? FOLDERS : RESOURCES).doc(item.id)
      .set(Object.assign({name}, item.isFolder ? {} : stamp(actor)),
          {merge: true});
  const {folders} = await loadAll(db);
  return describe(Object.assign({}, item, {name}), folders);
}

/**
 * File something somewhere else. A folder may not go inside itself or inside
 * something it already contains — FilingCore answers that, with a sentence.
 * @param {object} db the Firestore handle
 * @param {object} args {resourceId, folderId}
 * @param {object} actor the caller
 * @return {Promise<object>} the record
 */
async function move(db, args, actor) {
  const a = args || {};
  const item = await loadEither(db, a.resourceId);
  const target = (a.folderId === Filing.TOP_LEVEL) ?
    null : (a.folderId || null);
  const {folders} = await loadAll(db);

  if (target && !folders.some((f) => f.id === target)) {
    fail(`No folder has the id "${target}". Call resource_list to see the ` +
      "folders.");
  }
  if (item.isFolder) {
    const verdict = Filing.canMoveFolder(folders, item.id, target);
    if (!verdict.ok) fail(verdict.why);
  }

  const patch = item.isFolder ?
    {parentId: target} : Object.assign({folderId: target}, stamp(actor));
  await db.collection(item.isFolder ? FOLDERS : RESOURCES).doc(item.id)
      .set(patch, {merge: true});

  const moved = Object.assign({}, item,
      item.isFolder ? {parentId: target} : {folderId: target});
  return describe(moved, folders.map(
      (f) => (f.id === item.id ? moved : f)));
}

/**
 * Take something off the shelf.
 *
 * ⚠ A FOLDER TAKES EVERYTHING BENEATH IT, so this refuses the first time and
 * names the count. The same shape printable_delete_page takes, and for the
 * same reason: a multiple-choice chip in a client is not somebody agreeing to
 * lose twenty files.
 *
 * The RECORD goes before the bytes. A failure in between leaves a file
 * nothing points at — inert — rather than a row whose file has gone.
 *
 * @param {object} db the Firestore handle
 * @param {object} bucket the Cloud Storage bucket
 * @param {object} args {resourceId, confirm}
 * @param {object} actor the caller
 * @return {Promise<object>} what happened, or what would
 */
async function remove(db, bucket, args) {
  const a = args || {};
  const item = await loadEither(db, a.resourceId);
  const {folders, resources} = await loadAll(db);

  const doomed = item.isFolder ?
    Filing.itemsUnder(folders, resources, item.id) : [item];
  const doomedFolders = item.isFolder ?
    [item.id].concat(Filing.descendantFolderIds(folders, item.id)) : [];

  if (item.isFolder && doomed.length && a.confirm !== doomed.length) {
    return {
      deleted: false,
      name: item.name,
      wouldDelete: doomed.length,
      folders: doomedFolders.length,
      names: doomed.map((r) => r.name),
      why: `"${item.name}" holds ${doomed.length} ` +
        `${doomed.length === 1 ? "file" : "files"}. Ask the person to say ` +
        "in chat that those should go, then call again with confirm set to " +
        `${doomed.length}.`,
    };
  }

  for (const r of doomed) {
    await db.collection(RESOURCES).doc(r.id).delete();
    if (r.storagePath && bucket) {
      try {
        await bucket.file(r.storagePath).delete();
      } catch (e) {
        // Already gone, or never landed. The record is the truth.
      }
    }
  }
  for (const id of doomedFolders) {
    await db.collection(FOLDERS).doc(id).delete();
  }

  return {
    deleted: true,
    name: item.name,
    resourcesDeleted: doomed.length,
    foldersDeleted: doomedFolders.length,
  };
}

// ── Pins (ADR-0083) ────────────────────────────────────────────────────────

/**
 * Pin something to the top of the library, at the bottom of the Pinned card.
 * Pinning is "keep this where I can find it", not "put this above everything
 * I pinned before".
 * @param {object} db the Firestore handle
 * @param {object} args {resourceId}
 * @return {Promise<object>} the record
 */
async function pin(db, args) {
  const a = args || {};
  const item = await loadEither(db, a.resourceId);
  const {folders, resources} = await loadAll(db);
  if (Core.isPinned(item)) {
    return describe(item, folders);
  }
  const pinRank = Core.nextPinRank(folders.concat(resources));
  await db.collection(item.isFolder ? FOLDERS : RESOURCES).doc(item.id)
      .set({pinRank}, {merge: true});
  return describe(Object.assign({}, item, {pinRank}), folders);
}

/**
 * Take it off the Pinned card. Clearing the rank IS unpinning; there is no
 * second record to keep in step.
 * @param {object} db the Firestore handle
 * @param {object} args {resourceId}
 * @return {Promise<object>} the record
 */
async function unpin(db, args) {
  const a = args || {};
  const item = await loadEither(db, a.resourceId);
  const {folders} = await loadAll(db);
  if (!Core.isPinned(item)) return describe(item, folders);
  await db.collection(item.isFolder ? FOLDERS : RESOURCES).doc(item.id)
      .set({pinRank: null}, {merge: true});
  return describe(Object.assign({}, item, {pinRank: null}), folders);
}

/**
 * Put the Pinned card in a given order.
 *
 * Takes the ids in the order they should read and walks them into place one
 * move at a time through ResourcesCore, so an assistant reordering the card
 * writes exactly what a person dragging it writes.
 *
 * @param {object} db the Firestore handle
 * @param {object} args {resourceIds}
 * @return {Promise<object>} the new order
 */
async function reorderPins(db, args) {
  const a = args || {};
  const wanted = Array.isArray(a.resourceIds) ? a.resourceIds.map(String) : [];
  if (!wanted.length) {
    fail("Give resourceIds — every pinned id, in the order they should read.");
  }

  const {folders, resources} = await loadAll(db);
  let everything = folders.concat(resources);
  const pinnedIds = Core.pinnedOrder(everything).map((p) => p.id);

  const unknown = wanted.filter((id) => !pinnedIds.includes(id));
  if (unknown.length) {
    fail(`These are not pinned, so they have no place in the order: ` +
      `${unknown.join(", ")}. Call resource_pin first.`);
  }
  if (wanted.length !== pinnedIds.length) {
    fail(`The Pinned card holds ${pinnedIds.length} ` +
      `${pinnedIds.length === 1 ? "thing" : "things"} and you named ` +
      `${wanted.length}. Pass every pinned id, in order.`);
  }

  // One move per position, each through the core, so the ranks that land are
  // the ranks a drag would have produced.
  for (let at = 0; at < wanted.length; at += 1) {
    const id = wanted[at];
    const held = everything.find((it) => it.id === id);
    const plan = Core.planPinMove(everything, {
      id,
      isFolder: !!held.isFolder,
    }, at);
    if (!plan.ok) fail(plan.why);
    if (!plan.writes.length) continue;

    const batch = db.batch();
    plan.writes.forEach((w) => batch.set(
        db.collection(w.isFolder ? FOLDERS : RESOURCES).doc(w.id),
        {pinRank: w.pinRank}, {merge: true}));
    await batch.commit();

    everything = everything.map((it) => {
      const write = plan.writes.find(
          (w) => w.id === it.id && !!w.isFolder === !!it.isFolder);
      return write ? Object.assign({}, it, {pinRank: write.pinRank}) : it;
    });
  }

  return {
    pinned: Core.pinnedOrder(everything).map((p) => describe(p, folders)),
  };
}

module.exports = {
  RESOURCES,
  FOLDERS,
  list,
  upload,
  addLink,
  createFolder,
  rename,
  move,
  remove,
  pin,
  unpin,
  reorderPins,
  loadAll,
  loadOne,
  loadEither,
  describe,
};
