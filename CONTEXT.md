# Mosaic Domain Model

## Language

**Elder**:
A church officer with a shepherding role. The canonical term in code (the `elder` Permission Level).
_Avoid_: Shepherd (use only as UI-facing label, never in code identifiers)

**Shepherding System**:
The set of features accessible to Elders and super admins. Surfaces in the UI as the "Shepherd Landing Page."
_Avoid_: Elder Dashboard, Elder System

**Elder Meeting**:
A formal gathering of Elders (e.g., a consistory or session meeting). Produces Meeting Minutes.
_Avoid_: Check-in, pastoral meeting

**Meeting Minutes**:
The official record of an Elder Meeting. An Elder Document stored in the `elder_documents` collection, organised within the Document Library. The `elder_meetings` collection is superseded by `elder_documents`.
_Avoid_: Notes, summary

**Shepherding Note**:
A typed, dated record attached to a Person's Shepherding Profile. Has a Note Type, an optional Subject Line, and a Note Body. Written by an Elder. Visible to all Elders and super admins. Any elder or super admin can edit or delete any note.
_Avoid_: Member note, pastoral note, check-in (use only as a Note Type value, not as the concept itself)

**Subject Line**:
An optional short plain-text field on a Shepherding Note. Serves as its human-readable identifier in the @-mention picker and in the note card header. Falls back to Note Type + date when absent.
_Avoid_: Title, heading, label

**Note Type**:
The category of a Shepherding Note. Known types: Elder Check-in, Elder Interview, Elder Meeting, Life Update, Prayer Request, Other. 'Elder Meeting' is the default type for notes created via a Person Panel inside an Elder Document. 'Prayer Request' is the type carried by a Shepherding Note generated from a Prayer Request. Extensible.
_Avoid_: Note category, note tag

**Note Body**:
The rich-text content of anything written in the Note Module — a Shepherding Note, Meeting Minutes, an [[Elder Document]] or an [[Event Document]]. Stored as TipTap JSON, everywhere, whatever it hangs off. Exports to Word and imports from it by a walk this codebase owns (ADR-0048). May hold headings, bold/italic/underline, highlights, fonts and sizes, bullet and numbered lists, tables, alignment, links and pictures — a picture rides INSIDE the body as a data URI rather than in Storage, so whatever rule governs the document governs the picture. May contain Cross-References, but only where the surrounding document is elder-only — see Note Module.
_Avoid_: Content, text, body (use Note Body as the full compound term)

**Note Module**:
The shared TipTap-based editor component used to author every Note Body. Mounted in different surrounding UIs depending on context (inline panel on Shepherding Profile; split-pane editor on Meeting Minutes page; the document editor on an [[Event Document]]).
- **The Cross-Reference picker is not part of every mounting.** An @-mention points at a Person, a Shepherding Note, an Elder Document or a Folder — all elder-only. A surface that anyone who can see an Event may read cannot offer a picker onto elder-only records, so the picker is on where the document is elder-only and off where it is not. The editor is shared; its extension set is decided per surface.
_Avoid_: Editor, rich text editor, text area

**Cross-Reference**:
An inline link embedded in a Note Body that points to a Person, Shepherding Note, Elder Document, or Folder. Triggered by typing `@` in the Note Module editor. Rendered as a styled chip. Stores the referenced entity's ID, kind (`person` | `note` | `elder_document` | `elder_folder`), and label at write time. The former `meeting` kind is superseded by `elder_document`. Reminders, tags, note types, and other metadata are not Cross-Referenceable.
_Avoid_: Link, mention, tag (tag refers to Shepherding Tag)

**Shepherding Status**:
The current pastoral attention level assigned to a Person, expressed as a combination of urgency (urgent, somewhat_urgent, not_urgent) and importance (important, somewhat_important, not_important). Can be set from the Shepherding Profile, the People list, or an Elder Document. Changing it generates a Status Change in the Pastoral Record. A Person with no status set has no assigned attention level.
_Avoid_: Priority, flag, alert level, severity

**Shepherding Profile**:
The elder-only view of an existing Person record. Displays the Pastoral Record for that Person. The underlying Person is created and managed in the People Manager; the Shepherding Profile layers on top of it.
_Avoid_: Member page, elder profile

**Pastoral Record**:
The chronological feed displayed on a Shepherding Profile. The single unified view of all shepherding activity for a Person, combining Shepherding Notes, Status Changes, and Tag Changes in reverse-chronological order.
_Avoid_: Activity feed, timeline, history log

**Status Change**:
A Pastoral Record entry that captures a transition in a Person's Shepherding Status. Records the previous and new status values, which Elder made the change, the source (Shepherding Profile, People list, or Elder Document), and an optional Explanation. Generated automatically whenever a Shepherding Status is set or cleared.
_Avoid_: Status update, status event, status history entry

**Tag Change**:
A Pastoral Record entry that captures a Shepherding Tag being added to or removed from a Person. Records the tag name, whether the action was an addition or removal, which Elder made the change, the source, and an optional Explanation. Generated when tags are changed from the Shepherding Profile or the People list.
_Avoid_: Tag event, tag history entry

**Explanation**:
An optional plain-text annotation that any Elder or super admin can add to a Status Change or Tag Change entry after the fact. Records the reason or context for the change. Distinct from a Shepherding Note — an Explanation is always scoped to a specific Status Change or Tag Change and carries no rich-text editor.
_Avoid_: Note (use Shepherding Note for standalone records), comment, reason

**Filtered View**:
A shared, elder-configured saved filter over the People list that appears as a table widget on every elder's Shepherd Landing Page. Any elder or super admin can create, edit, or delete one.
_Avoid_: Custom table, saved search, widget

**Follow-up Reminder**:
A standalone dated reminder visible to all elders on the Shepherd Landing Page. Can optionally @mention one or more Persons. Any elder or super admin can create one. Automatically disappears after its due date. Push notification delivery to specific elders is a planned future feature.
_Avoid_: Task, to-do, alert

**Shepherding Tag**:
A label that can be applied to a Person. Tags are the primary filter criterion for Filtered Views and the People list. Elders and super admins are the primary managers — any of them can create, delete, Rename, Merge, or apply/remove tags on a Person — but tags are not elder-only-*visible*: some tags (e.g. the Member tag, and any Membership Tag) are surfaced to ordinary members in the People directory. Visibility is governed per-tag, not by the tag concept itself, and there are two separate flags: `hidePeople` hides the *people* carrying the tag, while `hiddenFromOthers` hides the *tag* — its name — from everyone below elder. A hidden tag is therefore never offered as a serving rule in the [[Roles Manager]] and never named in one; an editor who meets a rule built on it is told only that it is private and still applies. Both flags are lifted for elders and super admins, who are who the tag hides things from everyone else *for*. A tag has a stable identity that is independent of its name: renaming a tag changes only its display name, never which Persons carry it. Examples: "Red Flag", "New Member Follow-up", "Married". Membership Tags are a special, code-defined subset — see Membership Tag.
_Avoid_: Label, category, attribute (and "elder-only tag" — visibility is per-tag)

**Membership Track**:
The single ordered progression a Person moves along in their relationship with the church: **Visitor → Regular Attender → Prospective Member → Member → Moving Membership → Previous Member**. A Person sits at exactly one Membership Stage at a time. The Track is the church-relationship state machine — the one canonical replacement for the previously conflicting `membership.status` field, the ad-hoc "Member" tag, and any use of Permission Level to imply membership. It is deliberately **not** a Permission Level. A Person's stage on the Track is *not* self-editable — only an editor (via the stage slider) can move someone along it.
_Avoid_: Membership status (as an enum synonym), member type, member level

**Membership Stage**:
One of the six code-defined positions on the Membership Track. The stages are baked into the code — their set, order, and names cannot be changed by any user. Moving a Person to a new stage is the only Track mutation.
_Avoid_: Membership state, status value

**Projected Tag**:
A Shepherding Tag that is **code-defined and projected from a source-of-truth field**, not hand-applied — its presence on a Person is written by the projection and never edited directly. Immutable: it **cannot be renamed, deleted, merged, or visibility-toggled** by anyone, because the code seeds and maintains it. Two families exist: **Membership Tags** (projected from a Person's Membership Stage) and the **Elder Tag** (projected from the `elder` Permission Level of a Person's Linked User). The generalisation of the previously membership-only "special code-defined immutable tag" idea.
_Avoid_: System tag, locked tag, derived tag (use Projected Tag)

**Membership Tag**:
A Projected Tag that *projects* a Person's Membership Stage onto them so the stage is filterable and searchable through the ordinary tag filter system (the reason the Track is represented as tags at all). Each Membership Stage maps to a **defined set** of Membership Tags — usually a single eponymous tag (Visitor→Visitor, Regular Attender→Regular Attender, Prospective Member→Prospective Member, Member→Member, Previous Member→Previous Member), but **Moving Membership projects two tags: its own Moving Membership tag *and* the Member tag**. This overlap is deliberate: it lets "the Members directory = every Person carrying the Member tag" stay a single trivial query while still distinguishing those mid-transfer. Advancing along the Track re-derives the whole set (removing tags the new stage doesn't project, adding the ones it does). Inactive projects the Inactive tag instead of any stage tag. Membership Tags are the membership family of Projected Tags. The Membership Stage field on the Person is the source of truth; the Membership Tags are its synced projection (written together, never edited independently).
- **Nothing writes a Membership Tag directly — not even the account sync.** A linked User at permission level `member` or above advances their Person's *stage* to Member and lets the projection follow ([ADR 0026](docs/adr/0026-the-account-sync-moves-the-stage-not-the-tag.md)); it refuses to touch a Person who is already a member, who is a **Previous Member** (they left — and that stage sits *later* on the Track than Member, so membership is always asked of the projection, never of a stage's position), or who is **Inactive**. The move logs a Membership Change to the Pastoral Record authored by "Account sync".
_Avoid_: Member tag (the legacy single "Member" tag this subsumes — the Member tag is now one of the code-defined Membership Tags), status tag

**Elder Tag**:
The Projected Tag that marks a Person as an Elder. Projected from the Person's Linked User having Permission Level `elder` — it is **not** hand-applied: linking/unlinking a User, or a Permission Level change to/from `elder`, adds or removes it. Like all Projected Tags it is immutable (no rename/delete/merge/hide). It is the canonical answer to "which Persons are Elders," and therefore supplies the assignable-elder set for Elder Assignment. Every Elder is also a Member, so an elder Person carries both the Elder Tag and their Membership Tags. Distinct from the `elder` Permission Level, which is the permission source the tag is projected from (the Permission Level grants shepherding *access*; the tag makes elder-ness a filterable, graph-visible Person attribute). Its visibility in the member-facing Membership Directory is **fixed and visible to ordinary members** (not toggleable, like all Projected Tags) — eldership is a public office.
_Avoid_: Elder role (that is the `elder` Permission Level), shepherd tag

**Membership Directory**:
The People directory as seen by the whole congregation, split into two tabs. The **Members tab** shows every Person carrying the Member tag (stage ∈ {Member, Moving Membership}). The **Non-members tab** shows the remaining active People who lack the Member tag (Visitor, Regular Attender, Prospective Member, Previous Member). Contact information is visible to members on both tabs (a member can look up a recent visitor). **Inactive** People appear on neither tab for a plain member. **The Track itself is editors-only reading**: a member sees one of two labels on a card, **Member** or **Non-member**, never a Membership Stage — where somebody sits between Visitor and Previous Member is pastoral, and the two tabs are already the whole of what the congregation is told. An editor reads the stage (and Inactive) in the same place, because moving people along the Track is their job; `ShepherdingCore.directoryMembershipLabel` is the one place that decides which of the two a viewer gets, on web and phone alike. On either tab, an editor can enter **Edit Mode** to manage People inline. Supersedes the former single filter that showed non-editors only the ad-hoc "Member"-tagged people.
- **It asks for an account, not for membership** ([ADR 0031](docs/adr/0031-the-directory-asks-for-an-account.md)). Every directory collection — the Person record, [[Family]], the tag vocabulary, [[Involvement]] and pastoral-prayer history — is readable by anybody signed in and by nobody else. Until MS-197 it was readable by the open internet, names, phone numbers and home addresses included. The floor is deliberately an **account** rather than a rank, because a brand-new user has no Person and no rank, and searching the directory for their own name is how they raise the [[Directory Request]] that gets them one — gating on membership would break the flow that makes people members. The *page* is still member-and-above: this is the lock, not the door. **An anonymous Firebase session does not count as an account** — anonymous sign-in is enabled on this project, so a bare `request.auth != null` would be satisfied by a token anybody can mint with the public API key; the rules ask `isSignedIn()`, which excludes it. Who may *hold* an account is a separate question, decided separately: sign-up stays open to anybody (MS-240).
_Avoid_: People directory (ambiguous with the editor-facing People Manager), member list

**Edit Mode**:
A toggle available to editors (and above) on the Membership Directory that turns the read-only directory into an inline People manager — the same surface, switched from viewing to editing People attributes (contact info, Membership Track slider, tags). The **stage slider sits on the card itself**, so an editor walks somebody along the Track without opening anything; the person modal carries the same slider, and the two are one control writing through one path. Off by default; a plain member never sees the toggle.
_Avoid_: Manage mode, admin mode

**Linked User**:
The association between a User (an authenticated account with a Permission Level) and a Person record, stored bidirectionally (`users.personId` ↔ `people.userId`) and set by an admin. When a User is linked, their own `profile.html` surfaces the **self-editable** fields of their Person and writes straight to the Person record (one source of truth, no copy). Self-editable fields are the Person's contact info (email, phone, address), birthday, and **Directory Photo**, plus `sex` **only while unset** (a person may set their sex once; changing an already-set value is editor-only). The Membership Track, Shepherding Tags, Shepherding Status, involvement, and all shepherding data are **never** self-editable. From the Membership Directory, a Person viewing their own detail card gets an "Edit my info →" link to `profile.html` rather than inline editing. Anniversary is deliberately *not* self-editable — it belongs to Family structures (added later).
- **Whoever may connect an account may disconnect it.** Editors, elders and admins break a link from the Person's card in the Membership Directory's Edit Mode ([ADR 0028](docs/adr/0028-editors-can-break-a-link.md)) — both sides in one write, through the `unlinkDirectoryPerson` callable, because the `users` collection stays admin-only. Breaking a link undoes **nothing else**: the Person keeps their Membership Stage, tags, Family and shepherding record. The [[Elder Tag]] clears itself, because it is projected from the link.
_Avoid_: Account link, member login (a User is not necessarily a member)

**Directory Request**:
Anything a person asks the church to change about **their own** directory record — the front door to a directory that is editor-authored on purpose and therefore cannot be corrected by the one person who knows it is wrong. Stored in `directory_requests`, with every document id namespaced `{uid}_…` (the security rules require it, which is how one person's requests stay out of everyone else's without trusting a field). Four **Kinds** share one queue and one inbox: a **Match Request** names an existing Person and says "that is me"; a **New Record Request** carries proposed details and says "I am not in the directory yet"; a **Name Fix** proposes the correct spelling of the requester's own name; a **Family Request** proposes one Family relation (add or remove a spouse, parent or child). A request is `pending` until an **Approver** — an editor, elder, admin or super admin, the same set as the directory's Edit Mode — resolves it. **Declining** closes it with an optional reason shown to the requester, who may withdraw it and ask again. Approval is a privileged act performed by the `resolveDirectoryRequest` callable, never from a browser: it writes `users/{uid}.personId`, `people/{id}.name` and the `families` collection on behalf of someone who may be a plain member. Decided in [ADR 0025](docs/adr/0025-link-requests-are-self-raised-and-editor-resolved.md), generalised in [ADR 0027](docs/adr/0027-a-directory-request-is-how-you-change-your-own-record.md).
- **A Match or New Record Request obtains a [[Linked User]]**, so only someone *without* a Person may raise one; a Name Fix or Family Request changes a Person you already have, so only a Linked User may. An Approver may **redirect** a New Record Request onto an existing Person they recognise, which prevents a duplicate rather than merging one later. A Person created this way starts at the **Visitor** Membership Stage — nobody self-declares onto the Membership Track.
- **A Family Request is replayed, not re-decided.** Approval runs the proposal through the same `planAddFamilyRelation` / `planRemoveFamilyRelation` planners the Membership Directory's write-through uses, against Families as they stand *at approval time*. Every household rule therefore lives in one place, and a proposal that has since become impossible is refused in the planner's own words.
_Avoid_: Link Request (the original, narrower name this subsumes), invite (nothing is sent to the person; they start it), claim, application, join request

**Directory Photo**:
A Person's picture, shown on their card in the [[Membership Directory]] and on their own profile page. **Self-editable** — you set your own without asking, and an editor sets or clears anyone's ([ADR 0029](docs/adr/0029-a-directory-photo-is-self-editable.md)). It sits with contact details rather than behind a [[Directory Request]] because nothing else in the app reads it as an identifier and nobody else's record moves when it changes — the line that also keeps the *name* editor-only. Stored as `photoUrl` + `photoPath` on the Person, with the bytes at `people_photos/{personId}/{fileId}` in Storage. Carries a **Framing** — `photoCrop: {x, y, zoom}` — stored beside the image rather than baked into it, so a photo can be reframed later without the original file; `PersonPhotoCore.frameStyle` is the one place it becomes CSS, shared by the reframing preview and every card, which is what makes the preview honest. A new upload resets the Framing to centred. **It surfaces everywhere an avatar does** — the Membership Directory on web and phone, the person page, the Auto-Assign scheduler, the Calendar's assignment lists, the Relationships tab, and both drawers — each falling back to `PersonPhotoCore.initialsOf` when a Person has no photo. Every upload is resized in the browser to 800px on its longest edge and re-encoded as JPEG, and every upload gets a **new path** — overwriting one would leave the browser showing the old face from cache. Clients never delete from Storage (those rules cannot tell whose photo it is); the `cleanUpReplacedPhoto` trigger removes a blob once the Person stops pointing at it.
_Avoid_: Avatar, headshot, profile picture (use Directory Photo)

**Family**:
A first-class entity (its own `families` collection) that groups a household for the Membership Directory: `{ husbandId?, wifeId?, childIds[], anniversary? }`. **Husband is exactly one male Person, Wife is exactly one female Person** (matching the `sex` enum); every field is optional, so partial families are allowed (a widow + kids, a childless couple, etc.). **Anniversary** (the couple's wedding date) lives on the Family, not the Person. Children are the shared `childIds` list — not duplicated onto each parent. **Multiple generations are emergent, not a nested tree:** a Person is a spouse in at most one Family (their marriage) and a child in at most one Family (their family of origin); a child who marries starts their own Family, and walking child → their-Family-as-spouse → that Family's children traverses the tree across any number of generations. **"At most one" is an invariant every writer owes, not a description:** the find-or-create planners always ask whose household a Person is already in before they write — naming a child's father seats the child in that father's *marriage*, never in a fresh Family — because a couple recorded twice is a couple married twice, and the Relations Viewer draws every copy. Joining two households that each already have a head is a restructure the quick-assign card refuses rather than guesses at.  **Editor-authored, not elder-only:** a Family is built and edited by an editor (or above) in the Membership Directory from *either spouse's card* — declaring who the spouse is and who the children are — never from the elder-only Shepherding Profile. On the Shepherding Profile it only **projects read-only** into the Relationships panel, as gendered Projected Relationships (Husband/Wife, Father/Mother, Son/Daughter, Brother/Sister; neutral fallback when sex is unset) covering spouse, parents, children, and siblings (siblings = the other children of the family of origin). Distinct from a Custom Relationship (the freeform, elder-authored edge model).
- **A serving rule can name a Family, and it reads the directory.** "No two people from the same Family" and "…the same Marriage" are the two [[Relationship Group]] types a Role may restrict on WITHOUT an elder sharing anything: they are projected from the `families` collection, not rostered by hand. `family` and `marriage` are reserved type ids for exactly this, and a Custom Relationship Type may not use them. Marriage is the two spouses; Family is the whole household — the narrower rule exists for the Role where a couple serving together is the problem but their teenager helping is not.
_Avoid_: Household (that is a [[Household]] — the kiosk grouping, not this kinship tree), family tree (that is the emergent traversal, not a stored structure), relationship (that is the freeform shepherd concept)

**Household**:
A named collection of people who belong together at the foyer — "The Harris Household" might be a married couple, their children, and a grandmother. Distinct from [[Family]], which is the kinship tree (husband, wife, children) and is not stretched to fit whoever walked in together. Stored in its own `households` collection ([ADR 0043](docs/adr/0043-households-are-stored-as-their-own-collection.md)). A Person may belong to more than one Household (a child of separated parents).
- **A Household is minted the first time somebody uses it** ([ADR 0044](docs/adr/0044-a-household-is-minted-the-first-time-it-is-used.md)). A Family still **projects** as a Household, and a Person in no Family and no stored Household still appears as a singleton, so search is never empty on day one — but a projection is the *guess*, and the moment a greeter marks people present from one or adds somebody to it, it is written down. The minted document keeps the projection's own id (`family:<id>` / `person:<id>`), which is what makes minting idempotent: **two greeters minting the same Household write one document, not two.** That is the duplicate the original design accepted and this one closes.
- **A Kiosk may add to a Household, and nothing else.** It cannot rename one or drop anybody from one — the rules pin that, not the page. Growing a household is a greeter's job on a Sunday morning; renaming or emptying one is an editor's, afterwards. Being able to add is what stops a greeter minting a second Harris household the day a brother turns up.
- **A Household is not a Family, and the two are allowed to disagree.** A Family that gains a child does not change the Household minted from it; the foyer catches up when somebody adds them. They are two collections precisely so neither has to lie about the other.
- **Households draw as bubbles in the [[Relations Viewer]]** — stored ones only, one colour for the lot, and never a leader, because a Household has no head. **The toggle starts off** and no View Preset turns it back on: there is a bubble per household, and all of them at once buries the web the page exists to show.
_Avoid_: House, family (that is the kinship tree), household group, projected household (that is the day-one fallback, not a thing anybody owns)

**Relationship**:
A connection among Persons, surfaced on the Shepherding Profile's Relationships panel (never in the member-facing Membership Directory). Elder-only, **except** for Types an elder has made a [[Shared Relationship Type]] — see ADR 0017; the panel itself remains elder-only regardless. Two kinds share the panel: a **Custom Relationship** (elder-authored, stored, deletable — a **Pairwise Relationship** or a **Relationship Group**) and a **Projected Relationship** (derived from Family). Elder Assignment is deliberately **not** shown in this panel — it is a relationship in the Relations Viewer graph only. Relationships can cross-cut households.
_Avoid_: Family (that is the tidy directory entity), tag (that is a Person label, not a Person-to-Person edge)

**Custom Relationship**:
An elder-authored, stored, deletable Relationship carrying a Relationship Type — the freeform, hand-built layer (vs. a Projected Relationship, which is derived from Family). Two shapes: a **Pairwise Relationship** — a typed edge between two Persons — and a **Relationship Group** — a named roster of a Group-kind type. Authored in the **Relationships tab** of Manage Tags and Relationships (where types are also defined), or quick-added from a Shepherding Profile into an **already-defined** type. Only Custom Relationships are deletable; Projected Relationships are not.
_Avoid_: Manual relationship, freeform edge (use Custom Relationship)

**Pairwise Relationship**:
A Custom Relationship that is a single typed edge between two Persons, stored in the `relationships` collection as `{fromId, toId, typeId}`. If its Relationship Type is **Prioritized**, `fromId` is the **priority holder** (shown with the type's Holder Label) and `toId` the Counterpart; if **Non-Prioritized** it renders symmetrically.
_Avoid_: edge, link, directional relationship (use Pairwise Relationship)

**Shared Relationship Type**:
A **Relationship Type** an elder has marked visible to **editors**, so serving restrictions can use it ("no married couple in this Role", "staff this Role from one house group"). Sharing is per Type and **off by default** — sharing Marriage says nothing about Discipleship — and only an elder can change it. Sharing a Type also shares the **Pairwise Relationships** and **Relationship Groups** carrying it; a shared **Group**-kind Type therefore exposes whole rosters, which is a larger disclosure than a shared pairwise Type. The floor is **editor**: members and viewers see none of it, shared or not. Writes stay elder-only. Fails closed — anything not explicitly shared is private. Decided in [ADR 0017](docs/adr/0017-shared-relationship-types-elder-controlled-editor-disclosure.md).
_Avoid_: Public relationship, visible relationship, exposed type (use Shared Relationship Type)

**Relationship Group**:
A Custom Relationship that is a named roster of a **Group**-kind Relationship Type — one record naming the group (e.g. "Tuesday Bible Study") and listing its member Persons. If its type is **Prioritized** it has a single **leader** (the priority holder, shown with the Leader Label) plus members; if **Non-Prioritized** it is a flat roster with no leader. A Person may belong to many. Distinct from a **Care Group** (an Elder's assigned People, derived from Elder Assignment) and from a **Family**.
_Avoid_: Care Group, small group, cohort (use Relationship Group)

**Projected Relationship**:
A relationship shown in the Relationships panel that is **derived at render time from Family** (spouse, parent, child — via FamilyCore) and never stored as an edge. Its display is always a synced view of the Family (the source of truth), but it **can be authored from the panel by write-through**: adding or removing a Family relation from the quick-assign card writes straight to the `families` collection (find-or-create / detach), never a parallel edge. Removal is scoped to the individual (e.g. pull from `childIds`); removing a **spouse** necessarily ends the mutual pairing. Full family restructuring still lives in the Membership Directory. (Elder Assignment is *not* a Projected Relationship — it never surfaces in the panel; it feeds only the Relations Viewer.)
_Avoid_: Auto relationship, derived edge (use Projected Relationship)

**Elder Assignment**:
The pastoral-care link marking which single Elder is responsible for shepherding a Person. A Person has **at most one** assigned Elder (their shepherding elder); an Elder may shepherd many People — their **Care Group** (the reverse set). Authored in a dedicated single-elder-picker section on the Person's Shepherding Profile. It does **not** appear in the Relationships panel at all — it lives only in that dedicated section and supplies the "view by elder" axis of the Relations Viewer. Distinct from the Elder Tag (which marks who *is* an elder, not whom they shepherd) and from a Custom Relationship (freeform, deletable).
_Avoid_: Elder link, shepherd assignment (use Elder Assignment), care group (reserve for the reverse set — an Elder's assigned People)

**Relations Viewer**:
An elder-only visual tool on the Shepherd Dashboard for exploring how People are connected. People are nodes; their relationships are edges, rendered in an **interactive force-directed graph** — an Obsidian-style physics simulation where nodes are draggable and their connected neighbours follow. There is **one layout** (the physics web); the different "views" are just **edge-type filtering**. A left-hand **Edge-Type Toggle List** switches individual edge types on/off — one entry per Relationship Type (the elder-defined vocabulary, growing automatically) plus **Family** and **Elder Assignment**. Three **preset buttons** — **Full Web** (all edge types on), **By Family** (only Family on), **By Elder** (only Elder Assignment on) — set the toggles to common configurations; the elder can also set any combination by hand. A separate **Show-Isolated toggle** controls whether People with no *currently-visible* edges are hidden or shown. Clusters (households, Care Groups) are **emergent** from the filtered edges under the physics sim, not a separate layout mode. Clicking a person opens the **[[Detail Panel]]** down the right-hand side. Visual/layout/styling design is authored separately (Cloud Design); this entry fixes only the data-and-behavior contract.
_Avoid_: Relations Dashboard, relationship graph (use only as prose), view mode (there is one layout, filtered by edge type)

**Detail Panel**:
The scrollable aside the [[Relations Viewer]] opens down its right-hand side when a Person is clicked. It shows who they are, who shepherds them, and every Relationship they carry grouped by type — and it **edits three things**: the [[Membership Track]] (stage slider + Inactive toggle), the [[Shepherding Status]] matrix, and their [[Shepherding Tag]]s. Those three are the same sections the [[Shepherding Profile]] carries and they write through the same paths, stamping `relations_viewer` as the source on the [[Pastoral Record]] entry — an elder sweeping the web before a meeting never has to leave it. A change to the Track redraws the Person's node under the panel; marking somebody Inactive while Show-Inactive is off takes their node off the web but leaves the panel open on them, which is the only way to undo it. Everything else about a Person still lives on the full Shepherding Profile, one button away. Editing is **per control and immediate** — the panel is a page surface, not a dialog ([ADR 0032](docs/adr/0032-a-page-saves-itself-a-dialog-does-not.md)).
_Avoid_: Person Panel (that is the block inside an [[Elder Document]] — ADR 0004), profile pop-up, person card, modal (it is neither a pop-up nor a dialog)

**Relationship Type**:
A reusable, elder-defined definition for a kind of Relationship, saved once and re-appliable — the vocabulary grows as elders add types, parallel to how Shepherding Tags accrue. Every type has two axes. Its **kind** is **Pairwise** (connects two Persons) or **Group** (a roster of many Persons). Its **priority** is **Prioritized** or **Non-Prioritized**: a Prioritized type names two roles — the **Holder Label** and **Counterpart Label** for a Pairwise type (e.g. Discipler / Disciplee), or the **Leader Label** and **Member Label** for a Group type — and renders oriented; a Non-Prioritized type names a single symmetric **Label** (e.g. Friendship, or a group's Member Label) and renders unoriented. Defined in the **Relationships tab** of Manage Tags and Relationships — **never** created inline on a profile. Distinct from a Shepherding Tag: a Tag labels one Person, a Relationship Type labels a Relationship among Persons.
_Avoid_: Relationship tag, edge label, directional (**Prioritized** is its enriched successor)

**Role** (umbrella):
A type of participation a Person is assigned to for an **Event**, recorded as Involvement. Two families: **liturgical Roles** (preacher, service leader, worship leader…) are **locked** — code-defined, undeletable, and wired into the Service entity and the Service Guide — while **Servant Roles** are editable **Role Definitions**. Assigned to People on the **Roles tab** and in bulk from the **Roles Manager**. Distinct from **Permission Level** (a User's access) and **Membership Stage** (a Person's church relationship). Decided in [ADR 0016](docs/adr/0016-roles-as-events-locked-liturgical-editable-servant.md).
_Avoid_: using "role" for access (that is Permission Level) or for membership (that is Membership Stage)

**Servant Role**:
A non-liturgical service contribution — kids ministry, setup/teardown, coffee, sound, etc. — as opposed to the locked liturgical Roles. Unlike liturgical Roles, a Servant Role is an editable **Role Definition** authored in the **Roles Manager** and assigned to People per **Event**. Recorded as Involvement like liturgical Roles (the model is **role-open** — any `type` slug is accepted, no schema change). Groundwork laid by the People System (MS-81); the scheduling feature itself is MS-22.
_Avoid_: Ministry role, volunteer role (use Servant Role), duty

**Role Definition**:
The editable specification of a **Servant Role**, authored in the **Roles Manager**: a name, an ordered set of **slots** (each requiring **male**, **female**, or **either** — three people needed means three slots), and optional **restriction rules** that read existing Shepherding Tags and Relationships (e.g. "no married couple in this Role", "exclude anyone tagged X"). Liturgical Roles are the locked, code-defined counterpart and have no editable Role Definition.

Every restriction here is a rule the Role makes about **itself**, and holds wherever that Role runs. A rule about *two* Roles is a [[Cross-Role Rule]] and lives somewhere else.

It also carries a **Role Description** — see below.
_Avoid_: Role template, role config

**Role Description**:
What the job actually is, in the editor's own words: *"Arrive by 9:15, put the urns on, and set out the mugs on the side table."* Written on the [[Role Definition]] in the [[Roles Manager]], and read at **every moment somebody meets that Role** — beside the date on their [[Commitment]]s page, on the row waiting for their answer, on the [[Cover]] list, when somebody asks them personally through a [[Trade]], and in both directions of a Trade's picker. A Role's **name is a label**, and a label is not an answer to "what am I meant to do?".

- **One field of plain prose**, never a checklist or a set of steps. The moment it has structure it wants a screen of its own; what is worth having is the sentence the Role's organiser would say if you asked them in the corridor.
- **Capped, and the cap is in the model** rather than in the text box — `/roles` is editor-writable by hand, and a wall of text would run down every Commitments row that shows it.
- **Shown plainly, not behind a "more".** The whole reason it exists is that somebody down for a Role should not have to ask what it involves, and a description you have to open is one you find out about after you needed it. The cap is what keeps that affordable.
- **It earns most where somebody is DECIDING, not reading.** Three of the places it appears are a choice — a place waiting on your answer, a [[Cover]] place you have never done, and picking which Assignment to take or hand over in a [[Trade]]. On the [[Cover]] list it shows on the rows you *cannot* take as well, level with the rest: the reason is already stated once, and hiding what the job is on top of that makes the row less of an answer, not more.
- **Absent and empty are the same thing** — there is nothing to show — so no surface has to tell them apart.
- A [[One-off Role]] has no definition and so has none; its label is all there is. **Liturgical Roles have none either**, and that is not a gap: they are code-defined with no editable definition at all (ADR-0016), and giving one a description would mean giving it a stored definition.
_Avoid_: instructions, notes, job description, role info

**Cross-Role Rule**:
A serving rule about a **pair** of Roles rather than one — "the Children's Ministry Leader and the Children's Ministry Helper cannot be from the same Marriage". Neither Role can state it, because neither is the thing being constrained: **the pair is**. So it belongs to the [[Event]] that runs both, which is also the only thing that knows they run together, and it is authored on [[Recurring Events]] rather than in the [[Roles Manager]].

Said in the **same words a Role's own group rule uses** — *must be from the same* / *cannot be from the same* — over the same Group Types (Family, Marriage, or any [[Shared Relationship Type]] of the group kind). An editor who has written one of these once should not have to learn a second phrasing to say it across two Roles.

- **It bites the second seat.** Whoever is placed first has nobody to conflict with; the pair's other Role is what gets refused. That is the answer a person filling the rota by hand reaches, and the [[Warning]] pass checks the finished lineup either way round.
- **It is a rule about the roster**, so it advises an editor and refuses a member, like every other (ADR-0021, ADR-0030).
- **A rule naming one Role twice is refused** — that is the Role's own rule, and two places to look for why somebody was refused is one too many.
- **Dropping a Role from an Event drops the rules naming it.** One left lying about is worse than absent: add the Role back a year later and a rule nobody remembers writing starts refusing people.
- A [[One-off Role]] and a one-off Event have no series, and so have none of these.
_Avoid_: Pair rule, role-to-role constraint, global rule (it belongs to one Event, not to the church)

**Event**:
A dated occurrence that carries **Roles** to be filled. A Sunday **Service** is one **locked, recurring** Event — always present, its liturgical Roles undeletable. Arbitrary Events (introduced with the Calendar, MS-99) can carry Servant Roles too. Fairness is scoped **per Event series**: a Person's serving history for a Role is counted within that recurring Event, not globally, so someone can be overdue for one Event's Role and fresh for another's at the same time.
_Avoid_: Meeting, appointment (use Event); do not conflate with Service (a Service is one kind of Event)

**Kiosk**:
A User whose `permissionLevel` is `kiosk` — a shared, unattended device account, signed in once and left running in a public room to mark [[Attendance]]. Reads like any other signed-in account at the rules layer ([ADR 0041](docs/adr/0041-a-kiosk-account-reads-like-any-signed-in-account.md)); the narrower promise ("only names and who is in which [[Household]]") is a property of its one screen, not of what its credential can technically reach. Every other page in the app refuses it, checked on load like any other permission gate. Never linked to a Person, never appears in the Membership Directory as an account holder.
_Avoid_: Device account, shared account (use Kiosk)

**Attendance**:
A record that a Person was physically present at a particular Event, marked live at a Kiosk. Stored on the Event occurrence (`event_occurrences/{id}/attendance/{personId}`), not on the Person — the reverse of Involvement, and deliberately so ([ADR 0042](docs/adr/0042-attendance-is-written-live-and-lives-on-the-event.md)): there is no plan behind it to confirm, no nightly conversion, just a tap that is true the moment it's made. Distinct from Involvement, which answers "did they serve," not "were they here" — a Person can have either, both, or neither for the same Event.
_Avoid_: Check-in (already claimed by the "Elder Check-in" Note Type), presence, attendance record (use Attendance)

**Kid**:
A Person marked as a child for foyer name tags — they get a child tag and a matching guardian stub with a [[Pickup Number]], rather than a plain adult tag. Set when a Household is created at the Kiosk, or later by an editor on the Person in the Membership Directory. Distinct from being a child on a [[Family]] (that is kinship). A Family child still projects as a Kid on the projected Household so existing directory children get the right tags on day one.
_Avoid_: Child (use Kid for the tag mark; child stays the Family relation), minor, youth

**Name Tag**:
A 75mm × 50mm label printed at the Kiosk when an Event is marked as needing them. An adult gets one tag with their name. A Kid gets two: their own tag and a guardian stub, both carrying the same Pickup Number. Printed as HTML through the browser and the Zebra driver already on the kiosk machine — nothing extra to install. Attendance is written first; a print failure never undoes it.
_Avoid_: Label, badge, check-in tag

**Pickup Number**:
A short code unique to one Kid at one Event, printed on both the child's Name Tag and the guardian stub so they can be matched at pickup. Generated at the moment they are marked present. A second mark at the same Event reuses the same number; a different Event gets a new one.
_Avoid_: Pickup code (the printed thing is a number-like token, but call it Pickup Number), barcode

**Roles tab**:
The surface that puts named People into a single Event's Roles — every Role that date carries, its slots, each Assignment's state, and the picker that shows who was passed over and why. **One surface, two homes**: it is the Roles section of the Event detail screen, and it is a tab on the service page beside the Order of Service, because the Sunday is staffed every week and its order of service is edited elsewhere. Both mount the same markup and the same behaviour, so they cannot drift.

**It fills Roles; it does not decide which exist.** Which Roles an Event carries belongs to the **Event series** and is set there — deciding it from inside one date would change every date. So on the service page the tab has no way to add or remove a Role, only a way through to where that is decided. **Liturgical Roles are absent from it**: they are fields on the Service that the printed guide reads, set in the Order of Service (ADR-0018 §2).
_Avoid_: Roster tab, assignment tab, staffing screen

**Roles Manager**:
The editor+ dashboard card where **Role Definitions** are authored and managed. Distinct from the **Roles tab**, which assigns a single date by hand, and from [[Auto-assign]], which drafts a stretch of dates at once.
- **One Roles Manager, opened on both.** The phone does not get a port of this screen; it opens the same page inside the shell (`?shell=mobile`), reachable from the phone's home grid, which is the phone's dashboard. This screen is where a Role's slots and restriction rules are decided, so a second copy of it would be a second place for those rules to drift from the model.
- **On a phone it is a list, then an editor** — never both, because there is only room for one. The list's rows become cards you tap; delete moves into the editor's own bar, and the only back arrow is the shell's, which the page answers: out of the Role you have open, or out of the page if you have none.
_Avoid_: Scheduler page, role admin

**Auto-assign**:
The surface that staffs a **stretch of dates at once** — pick a recurring **Event** and a date range, and [[Fairness]] drafts a lineup for every managed Role on every date in it, which the editor reworks and then accepts (propose-then-approve). Its own screen, reached from the **Calendar**, because it is the one serving surface whose subject is a *run* of dates rather than one of them.
- **It also opens blank.** An editor who already knows who they want gets the same grid with nobody in it, and puts people in from the directory themselves — because a rota you have to undo is worse than no rota, and the long way round to an empty grid was to draft eight dates and then take everybody off them. A [[Blank draft]] is a *draft*, not a second screen: the grid, the drag, the [[Warning]]s and accepting cannot tell one from the other and must never have to. So the two doors sit side by side, on this screen and on [[Recurring Events]] — the choice is which picture gets drawn **first**, and by the time you are looking at the wrong one it has been drawn.
- What it produces is a **draft**: proposed, not committed. Nothing in it is an [[Assignment]] until the editor accepts, so nothing in it counts as serving or moves anyone's [[Fairness]] numbers.
- It fills **managed** Roles only — those with a [[Role Definition]], which have the slots, requirements and restriction rules a solve can reason about. A [[One-off Role]] on a date in the range is **shown and left empty** for the editor to fill by hand: there is nothing to be fair about and nothing to check a pick against.
- **Accepting an incomplete draft is allowed.** An empty place is a real answer — the editor can leave it and settle it nearer the day.
- **The range has no limit.** Past the [[Fairness]] window the later dates are balanced against drafted work rather than real history, which is not worth refusing or warning about: a draft that far out is a sketch, and the answer is to re-draft it nearer the time.
- **Editing one date does not redraw the ones after it.** They were balanced against the date as it was, and they say so; a *re-draft from here* redraws them on request. A table that rearranges itself while it is being reviewed cannot be reviewed — the same reasoning that kept the solve deterministic (ADR-0020 §6).
- **Desktop only.** Unlike the [[Roles Manager]], this screen does not open in the mobile shell. It is a wide grid of dates against Roles, and there is no honest phone reading of it — the phone says so rather than showing a broken one.
- **A draft lives in the browser, never on the server.** It survives a reload and a closed tab, keyed by Event and range, and is re-checked against current people, Roles and dates before it is offered back. It is not an [[Assignment]] and gains no document: the assignment states are three and stay three (ADR-0018).
- **It starts from what people have already said.** Anybody [[Away]] on a date is never seated on it. A solve overrides nothing and never leaves a [[Warning]], so placing somebody who said they would not be there is not a move it may make — unlike the editor's own hand, which may do it and be warned. Leaving somebody [[Out]] is the editor's separate, draft-only move.
_Avoid_: bulk assign, the scheduler, Future Schedule

**Blank draft** — MS-219:
An [[Auto-assign]] draft nobody solved — the range, every place empty, waiting for the editor's own hand. Identical in every respect to a drafted one except that its empty places **carry no reason**: a reason means the solve tried this place and could not fill it, and "nobody was free" written against a place nobody asked about is a lie the editor would act on. Whoever is already on a date **stays**, under exactly the same keep / replace / leave-out choice a draft offers — emptying a stretch is a separate move that belongs to [[Recurring Events]]. It is only how the **first** picture was drawn, so *re-draft* and *fill the gaps on this date* both still work on it: an editor may start by hand and hand the rest back.
_Avoid_: manual mode, empty draft, hand grid (the surface is Auto-assign either way; "by hand" describes the start)

**Out** (on a draft) — ADR-0023 §5:
Somebody the editor has left out of a stretch of an [[Auto-assign]] draft. **A drafting move, not a claim about the person** — it empties their places on those dates and keeps them out of anything drafted afterwards, and it dies with the draft. Emptying the places and filling them again are opposite answers to the same question ("I will sort this out" against "give me somebody"), so the control asks rather than assuming. Deliberately **separate from [[Away]]**, which is a fact about a Person's diary written on their record: an editor leaving Bob out of one draft is thinking aloud, and thinking aloud must not end up quoted as Bob's own word.
_Avoid_: away, unavailable, absent (on a draft it is Out; on a Person it is [[Away]])

**Displaced**:
Somebody turned out of a place on a draft, waiting to be put somewhere else. A displaced person carries the date **and** the Role they came from, and stays on screen until the editor places them or leaves them out — vanishing them would make the editor rebuild from memory who they just lost.
_Avoid_: orphan, bumped, unassigned

**Swap**:
Two people on a draft trading places — **an editor's move, on an unsaved draft, writing no record.** Not a [[Trade]], which is the congregation's and is a real document. Offered when a card is dropped on a taken place and the card itself came from one: the screen shows the exchange — the other person drawn into the place the card is leaving — before it happens. Holding the card still on the place turns the offer into a [[Displaced]] instead, so both outcomes are the editor's and neither is the app's. Refused, never quietly corrected, when the trade would leave somebody holding two places in the same Role on one date; the offer becomes a displace.
_Avoid_: exchange, switch, shuffle

**Load nudge**:
Weeks of rest owed that an editor adds to somebody by hand, for a claim on their week the church has no record of — a new baby, a parent in hospital, a fortnight abroad. Denominated in the same unit as [[Load]] and the window, so it lands on the burnout line with no second scale to learn. **Not a [[Seeded serve]], and the two must never be merged.** A serve says *they held this Role on this date* and moves both of [[Fairness]]'s dials; a nudge says only *they are carrying more than the record shows* and moves the load gate alone. It belongs to the **draft**, not to the Person: it is what the editor knows while planning this stretch, and it writes no record anybody would later find and wonder about. Never takes a load below zero.
_Avoid_: load override, penalty, handicap, manual load

**Away**:
Somebody an editor has taken off a draft because they will not be there — for one date, or from a date to the end of the range. Their places are emptied and they are kept out of anything drafted afterwards, so it survives a re-draft. Distinct from [[Displaced]]: a displaced person is waiting to be put somewhere, an away person is not there at all. Emptying the places and filling them again are **asked, never assumed** — they are opposite answers to the same question, and either one chosen on the editor's behalf is wrong half the time. Like a [[Load nudge]], it belongs to the draft and writes no record.
_Avoid_: unavailable, blackout, absent, holiday

**Seeded serve**:
An [[Involvement]] an editor typed in rather than one the church lived through, recorded so a Role that launched with no history has something to be fair across. Recorded as a **serve** — a Role and a date — never as a load figure: [[Fairness]] has two dials, and a figure would move load while leaving the solve believing the person had never held the Role. It is a claim about the **past**, so it saves at once rather than waiting for the draft to be accepted, and only a seeded record may be taken back on this screen.
_Avoid_: manual load, load override, starting load

**Permission Level**:
An authenticated User's access tier — the concept formerly called the User **role** (viewer → member → editor → elder → admin → super_admin). Renamed to free the word "role" for serving **Roles**; the tier values are unchanged. The stored field is `users.permissionLevel`; the legacy `role` field is retained as a fallback (read by the Firestore rules and by client reads) until the migration completes and MS-127 drops it. Distinct from **Membership Stage** (church relationship) and **Role** (serving).
_Avoid_: User role, access role (use Permission Level)

**Inactive** (a Person):
An off-Track state, toggled beside the Membership Stage slider. Marking a Person Inactive **removes their spot on the Membership Track** (they carry no Membership Stage while Inactive) and applies the Inactive Membership Tag in place of a stage tag. The Person's record stays **fully visible** — Inactive is *not* archival and does not hide the record; it is reserved for later use such as surfacing stale records that may warrant deletion. Distinct from **Previous Member**, which is a genuine Track stage (someone who was a Member and has since left but is still a tracked relationship). The prior Membership Stage is retained under the hood so that clearing Inactive restores the Person to where they were on the Track. Replaces the old `membership.status: 'inactive'` value; the existing "active people" filters (`status !== 'inactive'`) become "not Inactive."
_Avoid_: Archived, hidden, deleted, dormant

**Non-server** (a Person):
Somebody no rota ever offers a Role to — the youngest children, anyone too frail, anyone in a season of not serving. Held as a field on the Person (`doesNotServe`) and managed from the [[Roles Manager]], because it is a fact about the **person** rather than about any Role: a Role's `allowlist` answers *who may do this one*, and copying "does none of it" onto every Role is how the two go out of step the next time a Role is added. Absolute, like [[Inactive]] — not a candidate who lost, so there is no reason to show and no [[Warning]] to leave. **Hides nobody**: the name stays everywhere else in Mosaic, which is what separates it from a tag carrying `hidePeople`. It applies to elders and super admins too, since it is not a privacy rule for anyone to see past.
_Avoid_: excluded, blocked, ineligible, banned, exempt

**Away** (a Person, on dates) — ADR-0023:
A stretch of **whole days** a Person has said they will not be there — a holiday, a term off, a weekend at a wedding. A Person may hold several stretches; one date is a stretch of one. Whole days because absence is physical: somebody in Spain on the 14th is in Spain for everything on the 14th, and asking which of the church's gatherings they will miss is asking them to hold the church's calendar in their head to answer a question about their own diary. **Authored by the Person themselves, or by an editor** who was told in the car park.
- **Not the same kind of thing as the other reasons somebody is passed over.** Every other one is a rule the church wrote about its own roster — no two spouses, must carry this tag, kept to a named few — and ADR-0021 lets the editor overrule those because the editor is the final word on the church's own rules. Away is **a fact a Person asserted about their own life**. Overruling it is not judgement, it is disbelief.
- So it is **shown as a reason and remains placeable** (mechanically like any other), but it is **worded as the person's words rather than the system's verdict** — "Sarah said she's away", never "Unavailable". That wording is the safeguard, not the block.
- **Absolute to the machine.** [[Fairness]] and [[Auto-assign]] treat it as a hard no and will not seat somebody over it — the asymmetry is the decision, and it is ADR-0023. They override nothing today — every draft they emit is clean by design — and a program placing somebody who said they are away is indefensible in a way a human knowingly doing it is not.
- Distinct from a [[Non-server]] (does none of it, ever, and is not offered at all) and from declining an [[Assignment]] (an answer about one Event, not a fact about a date).
- **Not a recurring pattern.** "Every third Sunday" is a real thing shift workers live, but it is a shape of availability rather than an absence, and it is deliberately not this.
- **Its own screen, reached from the [[Calendar]]**, on a desktop and on a phone. The **grid is the only input on every size** — first tap the first day, second tap the last — because a date field and a calendar competing for the same tap made the common case look like a form. Nothing on it submits, approves or pends: the button says *I'm away these days*, and it is true the moment it is pressed.
- **Seen by editors and above, and by the Person themselves — nobody else.** A member has no business knowing who is on holiday, and the dates somebody's house is empty are not directory data: the [[Person]] record is readable by anyone with an account ([ADR 0031](docs/adr/0031-the-directory-asks-for-an-account.md)), so an Away is deliberately kept off it. When this was decided the Person record was readable by the open internet; closing the directory moved the premise one rung and left the conclusion exactly where it was.
- **It carries no reason.** "Away" is the whole of what a rota needs. A *why* is pastoral, and pastoral information has one home in Mosaic — a [[Shepherding Note]], seen by elders. A note here would be a second, thinner-walled place for the same thing.
- **Said before scheduling it is prevention; said after, it is the Person's own to sort out.** Entered ahead of time, nothing ever puts them on those dates and no one does any work. Entered over a place they already hold, it writes nothing to the [[Assignment]] — the roster reports itself with a [[Warning]], because a warning is judged from the roster as it stands and so appears and clears on its own. The Person is told at the moment they enter it that they hold places inside the stretch, since **the expectation is that they find their own replacement** rather than handing the hole to an editor. The editor seeing it is the backstop, not the plan.
_Avoid_: unavailable, blackout, absence, out (use Away)

**Membership Change**:
A Pastoral Record entry that captures a Person's move along the Membership Track (including onto/off of Inactive). Records the previous stage, the new stage, which editor made the change, the source, a timestamp, and an optional Explanation — mirroring Status Change. Generated once per slider move. The underlying Membership Tag swap is performed silently and does **not** generate Tag Changes; the Membership Change is the canonical record of the transition, and the Person's membership history is derived from these entries.
_Avoid_: Status Change (that is Shepherding Status), tag change, track change

**Assignment Change**:
A Pastoral Record entry that captures a change to a Person's Elder Assignment — being assigned to an Elder, reassigned to a different Elder, or unassigned. Records the previous Elder, the new Elder, which Elder made the change, the source, a timestamp, and an optional Explanation — mirroring Membership Change and Status Change. Generated once per change, made from the Assigned Elder section of the Shepherding Profile.
_Avoid_: Elder change, reassignment, care change (use Assignment Change)

**Red Flag**:
A Shepherding Tag (not a built-in field) used as the canonical example of elder-defined tagging. No special UI treatment beyond being a tag.
_Avoid_: Alert, priority, built-in status

**Rename** (a Shepherding Tag):
Changing a Shepherding Tag's display name while preserving its identity. Every Person who carried the tag still carries it, every Filtered View still targets it, and every Tag Change already recorded keeps referring to it. Distinct from deleting and recreating a tag, which would strip it from all Persons and lose its history.
_Avoid_: Retitle, relabel, edit tag

**Tag Merge**:
Folding one or more Shepherding Tags (the merged tags) into a single surviving Shepherding Tag. Every Person carrying a merged tag is left carrying the surviving tag instead, the merged tags are deleted, and the surviving tag's own flags are kept. Used to consolidate duplicate or superseded tags. A Merge is directional — the elder chooses which tag survives.
_Avoid_: Combine, collapse, deduplicate

**Tag Hold**:
The span of time a Person has continuously carried a Shepherding Tag: from the Tag Change that most recently added it (with no later removal) to now. Derived from the Pastoral Record, not stored as a field. A tag applied before Tag Changes were recorded has an unknown Tag Hold. When two tags a Person carries are merged, the surviving tag's Tag Hold reflects the earlier of the two applications (the longer hold).
_Avoid_: Tag age, tag duration, held-since

**Hold Duration**:
The length of a Tag Hold, expressed as a human-readable span (e.g. "3 months", "12 days"). The basis of the Hold-Duration filter, which narrows a Filtered View or the People list by how long each Person has held a tag. Each selected filter tag carries its own threshold, set by a slider on the tag chip — a dot on the chip's lower edge that slides from 0 (anyone carrying the tag) up to a year — and its own Hold Direction, which says which side of that threshold to keep.
_Avoid_: Tenure, elapsed time

**Hold Direction**:
Which side of a Hold-Duration threshold the filter keeps: **older** (held at least that long — the default) or **recent** (held less than that long). Set per selected filter tag by tapping the word on the tag chip. Stored as `gte` / `lt`; the words are always derived from the stored value, never saved alongside it, so a Filtered View saved before the words existed still reads as older. A Filtered View that stores no direction means older.
_Avoid_: At-least / less-than as the name of the concept — that is the scrubber tooltip's phrasing, not what the thing is called. (The stored field is `tagHoldCmp` and older code calls the value a `comparator`. Those are identifiers predating this term, not a second name for it.)

**Prayer Request**:
The specific thing a pastoral-prayer subject asks the church to pray about for a given Sunday. Captured against that Sunday's Pastoral Prayer (i.e. attached to the order of service) and, once captured, also recorded as a Shepherding Note of Note Type "Prayer Request" on the subject's Shepherding Profile (generated once, then independent). May be typed in by an Elder or super admin, or supplied by the subject themselves by replying to an automated text message. Visible only to Elders and super admins.
_Avoid_: prayer need, prayer ask, prayer text (prayer text belongs to the `prayer` role — praise/confession content led by a person, a different concept)

**Elder Digest**:
A text message sent to everyone carrying the Elder tag once every pastoral-prayer subject for a Service has a filled Prayer Request, summarising who is being prayed for, the service date, and each request. Sent only when the request that completed the set arrived as a texted reply — if an Elder fills the last one in by hand, no digest goes out, since they are already seeing the requests. Its purpose is to surface texted requests that no Elder was watching for.
_Avoid_: elder alert, prayer summary, notification (unqualified)

**Baptism Candidate**:
A Person who is baptized at a Service. A Service with `hasBaptism: true` carries a list of Baptism Candidates (Person references), replacing the former free-text baptism value. Being recorded as a Baptism Candidate sets that Person's `baptismDate` to the Service date. A candidate need not pre-exist as a Person — naming a new one creates the Person record.
_Avoid_: Baptizee, baptism name, candidate (unqualified)

## Service Guide Template System

**Page Template**:
A reusable definition of a single printable page, authored by an editor in the Page Library. Consists of user-written HTML/CSS (optionally inheriting a Style Preset) with embedded Components. Pages are composed into Service Guide Templates. The current special pages (title page, hymn sheet, pastoral prayer, Mosaic Kids, announcements, sermon notes, the Order of Service list) are reborn as developer-seeded Page Templates rather than hardcoded element types.
_Avoid_: Page type, element, layout

**Component**:
A developer-authored preset embedded in a Page Template via a custom HTML tag. Every Component is ultimately informed by a person; the distinction that matters is **which party informs it, on which surface** — because two parties produce a Service Guide (Party 1 builds the Order of Service; Party 2 assembles and prints the guide). So a Component is either a **Builder Component** (informed on the Order of Service editor) or a **Generator Component** (informed on the Service Guide generator). All Components ship with the application — editors place them but do not author them. Casual synonym: "dynamic component." Components are placed as **hyphenated custom tags** (e.g. `<oos-list>`, `<input-text>`, `<hymn-sheet>`, `<preaching-schedule>`) — the hyphen is required so the engine can find them without a full HTML parser. One Component (`hymn-sheet`) is **multi-page**: on a Page Template marked `emitsPages: 'component'` it emits its own ordered list of physical pages.
_Avoid_: Bound Component, Input Component (both superseded by Builder/Generator Component), Service Element (that is a liturgy sub-element), widget, control

**Order of Service value Component**:
A family of fine-grained **Builder Components** that each render exactly **one** liturgy value — a single hymn name (`<hymn-1>`, `<hymn-preparatory>`…), one scripture reference (`<ref-call-to-worship>`, `<ref-sermon>`…), or one service role (`<preacher-name>`…). They let an editor lay out the Order of Service page **by hand** — static labels typed as page HTML on the left, these value tags dropped in on the right — instead of relying on the single `<oos-list>` master Component. This works without a template loop because the liturgy is a **fixed, named set of slots**, not a variable list; a tag's **presence on a page is itself the request** to the Order of Service editor, and structural variation between Sundays (a missing hymn, a baptism) is expressed as a **different Page/Template**, never a conditional inside one page. `<oos-list>` is kept as a one-drop convenience. Introduced with the designed booklet ([ADR 0008](docs/adr/0008-service-guide-template-system.md) implementation notes; the loop question is discussed there).
_Avoid_: liturgy field tag, OOS row component

**Builder Component**:
A Component informed on the Order of Service editor by Party 1. Two presence kinds: a **static** Builder Component is prompted on every week regardless of template (the legacy Order of Service editor *is* exactly this fixed prompt set — service leader, hymns, preacher, theme…); a **non-static** Builder Component is prompted **only when the selected Service Guide Template requests it** (e.g. **Baptism** candidates, or a **Congregational prayer** when a member leads in the pastor's absence). A Builder Component may be **prompted** (the user types the value directly) or **derived** (the user types a *key* — a hymn name, an ESV reference — and the Component populates richer content from it, e.g. sheet-music images or verse text); either way the Order of Service editor is its source.
_Avoid_: Bound Component, liturgy field

**Generator Component**:
A Component informed on the Service Guide generator by Party 2 — the weekly fill-in-the-blanks the person assembling the printed guide supplies (e.g. the Pastoral Prayer's **Nation** and **Capital**). Always prompted (it has no derived form).
_Avoid_: Input Component, manual component

**Entry Field**:
The per-week input a Component declares so a person can inform it — a hymn name or ESV reference for a derived Builder Component, the candidate list for a Baptism, the Nation/Capital for a Generator Component. Which surface an Entry Field appears on is fixed by its Component: Generator Components surface on the Service Guide generator; Builder Components surface on the Order of Service editor, and non-static ones only when the chosen Service Guide Template requests them.
_Avoid_: Custom field, blank, prompt

**Page Library**:
The collection of all Page Templates available to compose into Service Guide Templates.
_Avoid_: Template library, page store

**Style Preset**:
A reusable stylesheet (master CSS) that a Page Template can inherit application-wide styling from. Editors author Style Presets; a Page Template chooses which one to inherit.
_Avoid_: Theme, master CSS (use only as descriptive prose)

**Service Guide Template**:
An ordered, counted selection of Page Templates from the Page Library that defines the structure of a Service Guide. Each entry is a **page placement** — `{ pageTemplateId, role, params }` — so the same Page Template can appear several times bound to different data: the single Hymn page is placed once per liturgy slot, each placement's `params.field` naming the slot (e.g. `hymn1`). Specifies page order, repetition, and which placement is the Filler Page (`role: 'filler'`). Because a template fixes which Components its pages contain, it also fixes which **non-static Builder Components** the Order of Service editor prompts that week — e.g. a template whose pages include the baptism component prompts Party 1 for Baptism candidates. This is why distinct templates exist for the combinations of non-static components (e.g. {with, without} Baptism × {pastoral, congregational} prayer). One Service Guide Template is the church-wide default; any week's Order of Service editor can override it for that week only. Stored in `guide_templates`.
_Avoid_: SG Template (use only as shorthand), guide layout

**Filler Page**:
The Page Template placement within a Service Guide Template designated to expand or contract in count to balance the booklet. It keeps at least one page and **auto-sizes the booklet to the next multiple of 4**: the booklet is the smallest multiple of 4 that holds every real page plus at least one filler, never below a floor (default 16). Extra content — e.g. a multi-page hymn — simply bumps the booklet up by four; it never overflows or drops content (the old "warn past target" behaviour was replaced, and the manual target-page control retired). For the designed booklet the Filler is the **blank continuation Sermon Notes page** (the "Main Idea of the Sermon" notes page is a separate, non-filler page so it always appears exactly once).
_Avoid_: Padding page, blank page, spacer, target page count

**Service Guide Manager**:
The editor+ authoring surface (`service-guide-manager.html`) for the Page Library, Style Presets, and Service Guide Templates. Carries the authoring guardrails — live validation, preview-before-save, and "reset to seeded default."
_Avoid_: Template editor (ambiguous), admin page

**Order of Service editor**:
The structured liturgy surface (`service-builder.html`) launched from [[Services]]. The editor fills it out **first**: preacher/hymn/person pickers and the Service Theme. It is the **first source** — the canonical structured Service that **Builder Components** are informed from. It is also where the week's Service Guide Template is chosen (or the legacy system toggled on) for the booklet that follows; in the new system the chosen template decides which non-static Builder Components (e.g. baptism, congregational prayer) it prompts, while the legacy system keeps the old "Include Baptism?" checkbox.

**It steps Sunday to Sunday.** Arrows beside the date open the next or previous Sunday without going back to [[Services]] — the guide party works forward through weeks nobody has touched yet, so an untouched Sunday is a destination, not something to skip. The far ends (the project's first Sunday, two years out) grey the arrow rather than failing quietly. Stepping leaves **no trail**: the `‹ Services` link is the way out and one press of the browser's back means the same thing, never *undo my last arrow*. The phone gets the same two arrows — the app shell draws its own header there, and the page's arrow group is moved into it rather than drawn twice — and, for the first time, the date they sit beside, which that header had never shown.
_Avoid_: OOS Editor (ambiguous — historically pointed at the generator), Order of Service Builder, builder

**Service Guide generator**:
The weekly surface the editor fills out **second**, after the Order of Service editor, to produce the printable Service Guide. It is the **second source** — it prompts for the snapshot's Entry Fields (the manual fill-in-the-blanks the Input Components declare), renders the live booklet, and prints. Two implementations both pull from the Order of Service editor: the **new generator** (`service-guide-editor.html`), driven by the chosen Service Guide Template; and the **legacy generator** (`service-guide.html`), the kept hardcoded eight-page system used when the week's Order of Service editor has "Use legacy system" toggled on (or for weeks created before this system, whose guide lacks `format: 'v2'`).
_Avoid_: OOS Editor, Service Guide Editor, guide builder

## Core Entities

### Person
An individual whose involvement with the church is tracked. This is the primary container for all data related to a church member or affiliate.
- **Fields**:
  - `name`: Full name.
  - `totalInvolvements`: Total count of involvement records.
  - `contact`: (Nested Object) Contact information.
    - `email`: Email address.
    - `phone`: Phone number.
    - `address`: Physical or mailing address.
  - `sex`: Gender of the person ('male' or 'female').
  - `membership`: (Nested Object) Status and church relationship.
    - `status`: 'member', 'regular_attender', 'visitor', or 'inactive'.
    - `joinedAt`: Date they became a member.
  - `lastPastoralPrayerDate`: The newest date (YYYY-MM-DD) in this person's `pastoral_prayer_history`, denormalised so the prayer rotation can rank everybody without opening a subcollection each. A **cache, never the record** — the history is the record, and anything holding the history reads that instead (ADR-0022). A Sunday still ahead counts: being booked is already a commitment to pray for that person, so it must stop the rotation offering them. `null` means never prayed for; the legacy `'0000-00-00'` is normalised away on read.
  - `baptismDate`: The date (YYYY-MM-DD) this person was baptized, derived from the Service at which they were a Baptism Candidate. Absent if they have not been recorded as baptized.
  - `createdAt`: Timestamp when the record was created.
  - `updatedAt`: Timestamp of the last modification.
- **Sub-collections**:
  - `involvement`: Records of active participation in services (e.g., preaching, leading).
  - `pastoral_prayer_history`: Records of when the person was the subject of the pastoral prayer — one doc per Sunday, whose **doc ID is the service date**. That ID is how a save addresses the record it means to remove, so anything copying these records (a merge, a schedule shift) carries it across rather than reissuing it (ADR-0022).

### Service
A liturgical event (usually a Sunday service), identified by its date (YYYY-MM-DD).
- **Fields**:
  - `isIrregular`: Boolean flag indicating if the service follows a non-standard structure.
  - `elements`: (For Irregular Services) An ordered array of objects representing the liturgy.
  - `serviceLeader`: Reference to a Person (historically a string).
  - `preacher`: Reference to a Person (historically a string).
  - `musicLeader`: Reference to a Person (historically a string).
  - `musicHelpers`: An ordered list of Person references who accompany the Music Leader (the Worship Helpers for this Service).
  ... (other liturgy fields)

### Service Guide
The printed document (output) handed to congregants. It is a persistent entity linked to a Service.
- **Components**: Includes the OOS plus "Guide-only" content:
  - **Title Page**: Date, theme, and key verse.
  - **Pastoral Prayer**: Specific prayer text/scripture for the week.
  - **Notes Pages**: Guided sections for sermon notes.
  - **Announcements**: Upcoming events and weekly schedule.
  - **Music Sheets**: Canonical hymns rendered as sheet music.
  - **Mosaic Kids**: Parent discussion and lesson details.
- **Persistence**: Configuration (element order, custom text, visibility) is stored in Firestore.
- **Editing**: Managed via a Split-View Editor with a Draggable Table of Contents and Live Preview.

### Order of Service (OOS)
The sequence of liturgical elements for a specific Service. 
- **Source**: Derived from the Service entity's liturgy fields (for standard services) or elements array (for irregular services).
- **Purpose**: Defines the sequence of events for the Sunday gathering. It is a core part of the Service Guide.

### Service Element (Irregular Only)
A sub-element of an Irregular Service's liturgy. (Distinct from a **Component**, which belongs to the Service Guide Template System.)
- **Fields**:
  - `key`: The label for the element (e.g., "Preacher", "Historic Confession").
  - `value`: The content or Person reference.
  - `type`: 'person', 'text', or 'hymn' (to determine the editor UI).
- **Syncing**: If `key` matches a **Canonical Role** or **Liturgy Field**, it syncs with the standard `Service` fields.

### Hymn Entry
A hymn selection within a Service's liturgy.
- **States**:
  - **Canonical**: Linked to a document in the `hymns` collection (has a valid `id`). This is the preferred state as it enables music sheet generation.
  - **Literal**: An unlinked name (has a `name` but `id` is null). These typically arise from docx imports where a match wasn't found. They must be resolved (linked to a Canonical hymn) to enable full functionality.

### Involvement
A record that a Person **did serve** in a specific Role at an Event. The single serve log — there is no separate one (ADR-0016). It records the past: an Involvement is never written for an Event that has not happened yet (ADR-0018 for Servant Roles, ADR-0019 for the liturgy).
- **Fields**:
  - `serviceDate`: The date of the event (YYYY-MM-DD).
  - `type`: The Role slug (see Roles). **Role-open**: any slug is accepted, so a new Servant Role needs no schema change.
  - `seriesId`: The **Event series** this serve belonged to (e.g. `sunday_service`). Fairness is counted per series, so this is what lets a Person read as overdue for one Event and fresh for another.
  - `metadata`: Optional extra data (e.g., prayer type, prayer text; the label of a [[One-off Role]]).
- A record written before `seriesId` existed **reads as** the Sunday Service (`EventsCore.seriesIdOf`). Without that fallback every historic serve would drop out of fairness the moment the field appeared. `scripts/backfill-involvement-series.js` makes it explicit, because a Firestore query cannot fall back.
- **An [[Assignment]] is not an Involvement.** The Assignment is the plan and is mutable; the Involvement is the fact and is written only once the date has passed. Only a **Confirmed** Assignment converts automatically.
- **The two families convert on different terms** (ADR-0019). A Servant Role's Assignment needs a **Confirmed** state, because somebody had to say yes and silence is never read as one. A **liturgical Role has no state** — it is a field on the Service, not a record of a conversation — so it converts **unconditionally** and raises no "did they serve?" question: being on the printed booklet is the commitment. Corrections use the manual Involvement add/delete on the Person's record.

## Roles
A Role is a type of participation assigned on an Event and recorded as Involvement. Two families (ADR-0016) — `RolesCore.allRoles()` composes them into the one list every surface renders.

### Liturgical Roles (locked)
Code-defined in `RolesCore.LITURGICAL_ROLES`, undeletable and uneditable, and still wired into the Service entity and the Service Guide. They have **no** editable definition and are **not** stored in `/roles` — storing copies would create a second source of truth and, since `/roles` is editor-writable, would make "locked" Roles editable. (`RolesCore.allRoles` refuses a stored definition carrying a liturgical slug, and the Roles Manager quarantines any that appears rather than rendering it.)
- **The one tunable thing about them is [[Role intensity]]**, which is a fairness weight and not part of the definition — preparing a sermon and reading a prayer are not the same work, and a church has to be able to say so. It lives in a `liturgicalIntensity` map on the [[Event series]] document, never in `/roles`, so the invariant above holds. A slug absent from the map reads as the default `1`.
- They are always **exclusive** ([[Role exclusivity]]) and hold no toggle: you cannot preach and run the sound desk.
- `service_leader`: The primary facilitator of the service.
- `preacher`: The person delivering the sermon.
- `worship_leader`: The person leading the musical worship. Surfaces in the UI as the "Music Leader."
- `worship_helper`: A person who accompanies the Music Leader (e.g. an accompanist or additional musician). A Service may have several. Surfaces in the UI as a "Music Helper." Distinct from `worship_leader` so helpers are separable in participation history and analytics.
- `prayer`: The person leading a specific prayer (praise or confession).

**`sermonette` used to be one of these and no longer is** ([ADR 0033](docs/adr/0033-a-sermonette-is-an-event-not-a-liturgical-role.md)). A sermonette is a shorter message given at a members meeting — a different gathering on a different day — so modelling it as a field on the Sunday Service meant recording it against a Sunday it did not happen on. It is now an [[Event]] with a [[Servant Role]] like every other non-Sunday serving. Involvement already written under the slug stays; the slug itself is deliberately free, so a Servant Role named "Sermonette" inherits that history rather than starting from nothing.

Related, but not Roles in the registry:
- `baptism`: A liturgical event marked by `hasBaptism: true`. The people being baptized are the Service's Baptism Candidates. Displayed as a read-only badge in the calendar views.
- `pastoral_prayer`: The person being prayed for in the weekly pastoral prayer (subject). Note: These are tracked in the `pastoral_prayer_history` collection, not the `involvement` collection.

### Role Definition (a Servant Role, editable)
The stored specification of a Servant Role, authored in the Roles Manager. Lives in the `roles` collection; editor-writable.
- **Fields**:
  - `name`: What the church calls it ("Kids Ministry").
  - `slug`: Derived from the name **once, at creation**, then fixed. Renaming the Role must not change the slug, or the Involvement already written under the old one would be orphaned. May not take a liturgical slug.
  - `family`: Always `servant`. A stored definition claiming `liturgical` is rejected — it would forge an undeletable Role.
  - `slots`: Ordered `{ id, requirement }`, requirement one of `male` / `female` / `either`. **Three people needed means three slots** — the slot, not a count beside a sex rule, is the unit of assignment, so a person can be pinned to a specific slot. Slot ids are never re-issued, since an assignment points at one.
  - `restrictions`: Rules read against existing data. Five kinds:
    - `requireTag` / `excludeTag` — a **Shepherding Tag** the Person must, or must not, carry.
    - `notTogether` — a **pairwise Relationship Type**: two People joined by it may not fill the same Role on the same Event (no married couple in Kids).
    - `notSameGroup` — a **Group** Relationship Type: no two People from one **Relationship Group** may fill the same Role, so it staffs across the congregation.
    - `sameGroup` — the inverse: everyone filling the Role must share one Relationship Group, so they already know each other. The only **cohesive** rule — it constrains the combination rather than the individual, so the first Person seated is unconstrained and being in **no** group of that Type is disqualifying (unlike `notSameGroup`, where it is harmless).
    - `allowlist` — **only these named People**, for the handful who serve communion or run coffee. A fact about the *Role*, not about the person, which is why it is not a Tag: Shepherding Tags are a pastoral concept, and configuring one Role should not mean editing five Person records. **Absent is not empty** — no rule means everyone, an empty list means nobody and is refused at authoring time. Editor-facing only; nobody is ever told they are on one.
    - A relationship rule may only name a [[Shared Relationship Type]]; one naming an unshared Type is refused rather than left to evaluate to "nobody qualifies".
  - `intensity`: See [[Role intensity]]. Defaults to `1`.
  - `allowsAnotherRole`: See [[Role exclusivity]]. Absent or `false` means exclusive, which is the default.
  - **A Relationship Group's leader counts as being in the group** for every serving rule. The leader is deliberately *not* inside `memberIds` (ADR-0014 §5), so the plain reading of the roster is wrong here — `RolesCore.inGroup` is the check to use.
- Eligibility (`RolesCore.candidatesFor`) returns every candidate with a **reason** when ineligible, never a silent omission — the Roles tab and auto-assign both have to explain who they passed over. An **Inactive** Person is never proposed; their Involvement history is untouched.

### Role intensity
**How much rest a Role owes the person who does it, measured in weeks.** Sound is `1` — someone can do it every week and stay fresh. Setup/teardown is `4` — a month before they should be asked again. Coffee is `1.25`: nearly every week, with the occasional break.

- A float, **at least 0**, defaulting to **1**. Every Role has one, including [[One-off Role]]s (set on the Event, not in the Roles Manager, since a one-off has no stored definition).
- **`0` means the job is free.** It is still serving, it still writes [[Involvement]], and it still moves the person's recency for that Role — it simply costs them nothing and never makes them look busy. For greeting at the door, or a job somebody actively wants, that is the honest number.
- Intensity is what makes different jobs comparable: it is the exchange rate between "sound every week" and "setup once a month". Without it, [[Fairness]] counts a morning of hauling tables as one job and a morning at the sound desk as one job, which is the thing every rota gets wrong.
- **Where it is stored depends on the family.** A [[Role Definition]] keeps its own. A [[Liturgical Role]] has no stored definition and may never have one, so its intensity lives in a `liturgicalIntensity` map on the [[Event series]]. A [[One-off Role]] keeps its own on the Event.

### Role exclusivity
Whether doing a Role uses up your morning. **Exclusive is the default and the assumption**: filling a Role means you fill no other at that Event. A Role whose `allowsAnotherRole` is checked does not tie you down — you can hold it *and* one other Role, provided that one is also permissive.

- A person may hold **at most two** Roles at one Event, and only when **every** Role they hold permits it. Holding any exclusive Role means holding nothing else, because that Role itself says so.
- Set in the Roles Manager for a [[Role Definition]]; set on the Event itself for a [[One-off Role]], which has no stored definition to hang it on. [[Liturgical Roles (locked)]] are always exclusive and offer no toggle.
- **Distinct from [[Role intensity]], and the two are easy to confuse.** Intensity says *this job tires you out*; exclusivity says *this job occupies you*. Greeting at the door is plausibly neither. Sound is plausibly intensity `1` but exclusive — easy work, but you are stuck at the desk all morning.
- [[Fairness]] never proposes a roster that breaks it. An editor may, and gets a [[Warning]] rather than a refusal (ADR-0021).

### Fairness
How the app decides who should fill a Role, so that nobody has to remember who did it last time and the same few people do not carry everything. Counted **per [[Event series]]** — someone can be overdue for Sunday setup and fresh for a midweek Role at the same time (ADR-0016 §5, ADR-0020).

**It solves one [[Event occurrence]] at a time.** A ten-week roster is the same step run ten times, each reading a history window that has rolled forward to include the weeks already drafted. There is no separate notion of "planned" work: last week's pick is simply part of this week's history.

Two measures, doing different jobs:

- **Load** — how much a Person is carrying this season. The sum of the [[Role intensity]] of everything they did inside the **window**, so it is denominated in weeks, and `load ≥ window` means they are over their rest budget. Load decides **who is considered at all**.
- **Recency** — how long since that Person last did *this particular* Role, capped at the window, so never having done it reads the same as not having done it all season. Recency decides **who gets which Role** among those considered.

The **window** is the last 12 occurrences of the series — a season for a Sunday. Measured in occurrences rather than weeks, so a fortnightly Event is judged on the same amount of its own history as a weekly one.

Who is considered:

- Every **active** Person, less anyone the Role's own rules exclude. Membership is not a fairness concept — a church that wants a Role kept to Members says so with a `requireTag` rule on that Role, since Kids and coffee should not share one answer.
- **Not** anyone holding a [[Liturgical Roles (locked)|Liturgical Role]] at this occurrence, and **not** anyone who has held one in at least half the window. The first is because you cannot preach and run the sound desk; the second is a guarantee where load alone would only be a tendency.
- The least-loaded are taken with room to spare, and the pool **widens** rather than failing when the Role's rules make a roster impossible. A spot that still cannot be filled is **left empty with the reason given**, never quietly dropped.

**It starts cold, and that is fixed by recording serving rather than by typing a number.** A Role that has just been created has no history, so everyone reads as equally fresh with no load and the first draft is settled almost entirely by the tie-break. An editor seeds it by adding the [[Involvement]] that already happened — the same manual add/delete the [[Membership Directory]] has, offered on [[Auto-assign]] where they are looking. Never a stored load figure: load has one source and must keep it, and a figure would move only the load dial while leaving [[Fairness]] still believing the person has never held the Role. It is not a blocker either — an unseeded first draft is arbitrary but still even, and it corrects itself from the second date, because the loop carries its own picks forward.

Fairness **proposes; it never forbids**. Everything it decides is a draft an editor approves ([[Auto-assign]]). Fairness itself will not propose a roster that breaks a Role's rules — a draft that starts by breaking the editor's own rules is not worth reviewing — but the editor may place whoever they need to, and gets a [[Warning]] rather than a refusal (ADR-0021).

### Event series
The recurring thing that carries Roles, in the `events` collection. The Sunday **Service** is one **locked** series (`sunday_service`): always present, undeletable, its liturgical Roles fixed to it. Servant Roles can be added to a series and removed again — locked protects the liturgical Roles, not the whole roster.
- **Fields**: `id`, `name`, `locked`, `roleSlugs` (ordered), `lockedRoleSlugs` (the ones that cannot be removed), the **recurrence rule**, and the series' [[Event visibility]].
- An occurrence of the Sunday Service resolves to the date-keyed `services/{date}` document that already exists — no shadow record — so the Service Guide keeps reading what it always read (`EventsCore.occurrenceRef`).
- `scripts/seed-events.js` reconciles the Sunday Service series: it restores what must be true and leaves alone what the user owns, so a second run is a no-op.

### Event occurrence
One dated instance of an [[Event series]], or a **one-off Event** that belongs to no series. What an [[Assignment]] attaches to (ADR-0018).
- **Sparse**: a document exists only once there is something to say about the date — an assignment, a cancellation, a changed time. The Calendar computes the dates from the series' recurrence rule and merges in whatever documents exist. An untouched date still appears; it is simply empty.
- **Deterministic id** (`{seriesId}_{date}`), so two editors cannot create the same occurrence twice. A one-off Event has no series and takes an auto-id.
- Carries its own [[Event visibility]], copied down from the series, and `participantIds` — the denormalised list of People holding a Role on it, which is what makes `participant` visibility checkable in a security rule.
- **One date decides WHO; the Event decides WHAT.** A **Sunday** is the same rule taken furthest: its pattern is settled by definition, its visibility by rule, and its liturgy belongs to the order of service — so one Sunday offers no pattern controls and no *Skip this one*, only who is serving and its own [[One-off Role]]s.
   Which Roles an Event carries, who may see it, and what colour it draws are true of every date, so they are set once in [[Event series management]]. One date of a repeating Event sets only who is standing in those Roles that day, plus its own [[One-off Role]]s. A control on both would change every date from a screen that looks like it is about one of them.
   - **The one exception is its `description`** (MS-288). Everything else true of a date is who is on it; a description is the one WHAT that can honestly differ week to week — "bring the trestle tables, we're eating after" is true of one gathering and wrong for the rest. So a date may carry its own, and it **adds to the Event's rather than replacing it**: an Event page draws **two descriptions**, the Event's words and then, under them, what is different about this date. They are also edited in two places and only two — the Event's in [[Event series management]], the date's on the Event page — because a box for the Event's words on a screen about the fifteenth of July would change every other week too. It used to override, which meant the week with the most to say showed the least. Cleared back to empty the date's stores `null`, and the Event's stands alone: `null` is "nothing is different about this one", which is not the same as saying nothing. Read by `EventsOccurrenceCore.eventDescriptionOf` and `dateDescriptionOf`, never stamped down — see **read through, never stamped** below.
- **Read through, never stamped.** A field a date reads off the series is resolved when it is drawn (`eventDescriptionOf`, `locationOf`), not copied onto the occurrence. Copied down it rides into the document on the next save and freezes that one date at the old answer, so changing the Event no longer changes it — the trap `time` and `seriesColour` were both pulled out of. [[Event visibility]] is the deliberate opposite and the only one: a security rule reads it off the document and cannot go and look at the series, so it *must* be stamped.
- **Roles come from two levels.** The [[Event series]]' `roleSlugs` apply to *every* date of it, minus the liturgical ones; `occurrenceRoleSlugs` are added to *this date alone*. Both draw as fillable cards with the full Assignment state machine, and neither can be added or removed from one date — `occurrenceRoleSlugs` is now legacy, read but no longer written.
- **`occurrenceRoleSlugs`** — which **managed** Roles *this date* needs, chosen on the Event detail screen. Deliberately **not** named `roleSlugs`: that is the [[Event series]]' field, saying which Roles the series carries. Two lists, two levels, two names — sharing one would read as a single field to anyone holding the series entry in their head. `oneOffRoles` sits beside it as `{ id, label }`, since a [[One-off Role]] exists only here.
- **The roster is a subcollection, not a field.** Firestore cannot hide a field from someone allowed to read the document, so "participants can't see who else is coming" only works if each [[Assignment]] is its own document under the occurrence. The occurrence itself carries only `participantIds` and the declined flag — both **derived** from the roster on every write, never maintained by hand.
- **`colour`** — which of eight palette colours it draws in on the Calendar. Kept on the [[Event series]] for a recurring Event, so one change moves every date; on the occurrence itself for a one-off, whose occurrence *is* the whole Event. Never copied down: unlike [[Event visibility]] (which a security rule reads off the document and so must be stamped), a colour is only ever read where the series is already in hand. Decoration only — **the red that means "needs sorting" is not in the palette and always overrides it**, so a chosen colour can never shout or stop something else shouting.
- **A Sunday occurrence is `services/{date}`**, which keeps its liturgical roles as the hardwired fields the Service Guide prints. Assignments sit *alongside* those fields and never over them. A Sunday's chip on the Calendar opens its **Event page** like any other date, where its **Servant** Roles are filled; the liturgy is one prominent click further on. **A liturgical Role is never drawn as a fillable card on an Event page** — that, not the routing, is what keeps the printed booklet safe.
- **An Event may RUN OVER SEVERAL DAYS** — a half-term, a conference, a week away. `endDate` is the last day, **inclusive**, because "23rd to 27th" is five days and an exclusive end would make every Event read a day short to whoever typed it. Decided in [ADR 0024](docs/adr/0024-a-run-of-days-belongs-to-a-one-off.md).
   - **A span belongs to a one-off and to nothing else.** How long an Event runs is true of every date of it, so on a repeating Event it belongs beside the pattern on the [[Event series]] — the same trap `time` and `colour` were pulled out of. Refused on a date of a series, with a sentence saying where it does belong. No repeating Event here runs over several days; when one does, the span goes on the recurrence rule.
   - **A run is stored under its FIRST day, so the Calendar's read reaches back further than the window asked for.** A range query on `date` drops a break that started in December from January, which is an absence rather than a wrong date and so is never reported. The read widens by the longest span the model allows and settles the overlap in code. **The 60-day cap is what makes that affordable** — it bounds the overshoot, and it catches the wrong year on a last day.
   - **It moves as a whole.** A schedule shift that moved the first day and left the last would give a run ending before it starts, which the model reads as no run — so a five-day break would quietly become one day.
   - **One Event on five days, not five Events.** It draws in every cell it covers, quieter from day two, and appears **once** in the list with "23–27 November" beside it.
   - **Not an all-day flag.** A conference starting at 9am on the Friday has a `time` as well.
- **One instance can be MOVED to another date without touching the recurrence rule** — "first Sunday of the month, except in August when it is the fifteenth". It is the same instance on a different day and **it carries its roster**, not a cancellation plus a new Event. Two documents result: the new date carries `movedFrom`, and the original carries `movedTo` — the original cannot simply be deleted, because the rule still produces that date and an absent document would draw the Event straight back. Refused onto a date the pattern already produces, onto a date that already has an instance, and for the Sunday Service (whose order of service lives under its own date).
- **A date that is not happening** — skipped (`cancelled`) or moved away (`movedTo`) — draws struck through and quiet on the Calendar, never in the error red, because a gathering that is not taking place has nothing to chase.
- **Skipping a date usually CREATES its document, so the skip is stamped like any other write.** A flag written on its own leaves an occurrence with no [[Event visibility]] — refused to everyone by the rule, dropped by every list query — so the skip lands in the database and then vanishes: the Calendar rebuilds the date from the pattern and draws the Event as though nothing had happened. On a date that already has a document only the flag is written, because re-stamping would wipe the `participantIds` the people stood down need to keep seeing it.
- **A Sunday Service is always on.** It cannot be moved and it cannot be skipped. Its order of service lives in `services/{date}` — under the DATE, not under the Event — so marking the Event off would leave that order of service standing and one Sunday would say two things. Both refusals live in `events-store.js` (`cancelOccurrence`, `moveOccurrence`) rather than in the page that hides the buttons, because this is a fact about the Sunday Service and not about one screen's markup. Skipping is refused in **both** directions: a Sunday can never be marked off, so "put it back" has nothing to undo. If a Sunday ever genuinely does not happen, that is a feature — the [[Services]] lists and the order of service would all have to show it — and not something this refusal quietly allows.
- **A one-off is DELETED; a date of a series is SKIPPED, never deleted.** A one-off *is* its single occurrence document, so deleting the document deletes the Event, and its roster goes with it (children first, the document last). A date of a series has a pattern above it that still produces the date — deleting it would only remove the note saying otherwise. Serving already recorded on people is untouched either way: an [[Assignment]] is the plan, an [[Involvement]] is the fact, and deleting the plan afterwards does not un-happen it.
- **A one-off Event's details are edited on its occurrence**, because it has no series for them to live on — including its **date**, which is simply a field: a one-off's id is an auto-id, not the date. (One date *of a series* is [[Event series management]]'s move, which must rewrite the id.)
- **An untouched date has no document, and still opens.** The id carries the series and the date, so opening one rebuilds it rather than reporting it missing — but only if the series' rule actually produces that date.
- **Two readings of the same date, not one screen with things greyed out.** An **editor** gets the Role cards: numbered places, empty rows, and each person's state to set. A **member** the roster was shared with gets the roster flat — who is serving, at what — because they are answering "who else is coming", not administering. A member used to get both at once, which named the same people twice on one screen and offered controls they could never use.

### Event series management
Managing an [[Event series]] itself rather than one date of it — **everything true of every date**: its name, start time, place, description, recurrence pattern, [[Event visibility]], colour, and which Roles it carries every time. The description set here is what every date says, and **the only place it can be set** — a date may add a line of its own about itself, which is the single carve-out to "the Event decides WHAT", but it cannot touch these words (see [[Event occurrence]]). Reached at `recurring-events.html?series=<id>` (moved there by MS-229; `calendar-event.html?series=` is no longer a page), and the only way into the **Sunday Service as an Event**. Distinct from the order of service, which is still built one Sunday at a time: a Sunday chip on the Calendar goes there, never here.
- **Liturgical Roles are shown and locked.** An editor needs to see the whole shape of a Sunday, but those Roles are filled per-Sunday through the Service entity and print in the booklet, so this screen can never drop one (`lockedRoleSlugs`, MS-13).
- **The time lives on the recurrence rule**, not beside it — one home for one fact — and a date carrying its own time still wins. Setting a Sunday time therefore ends the Sunday Service's reliance on its *implied* rule — so the rule written has to keep saying "every Sunday".
- Opening the Sunday Service **reconciles** it: created if it never existed, repaired if it drifted, untouched if it is already right.

### Assignment
A Person placed in one slot of one Role on an [[Event occurrence]] — **the plan, not the record**. Mutable, and never itself a serve record.
- A slot holds **one current** Assignment. Assigning a replacement overwrites it.
- **States** — every Assignment is in exactly one:
  - **Pending**: assigned, not yet heard from. The default. Reads as **Unconfirmed** to the Person themselves — the state is what the model stores, the label is what `stateLabel` renders, and only the second changes by who is looking.
  - **Confirmed**: they said yes.
  - **Declined**: they said no, and the slot is **flagged for reassignment** — visibly needing attention, not silently empty. Declining is how a Person asks for [[Cover]]; it does not hand the slot to an editor.
- Carries **who set the state and when**, so the state machine survives being handed to the congregation in MS-20.
- Only **Servant Roles** and [[One-off Role]]s get Assignments. Liturgical Roles keep their existing wiring into the Service entity (ADR-0018 §2).
- **Being *offered* is a different question from being *eligible*, and only the first is absolute.** An ineligible Person is shown with the reason, and **the editor** may place them anyway, leaving a [[Warning]] (ADR-0021). **A member may not** — taking [[Cover]] or settling a [[Trade]] is refused by the same reason that merely warns an editor, because nobody reviews what a member picks (ADR-0030). Somebody **Inactive**, a [[Non-server]], or hidden by a tag carrying `hidePeople` (or `shepherdingHidden`), is **not offered at all**: they are not a candidate who lost, and no rule about the roster can reach them. For a hidden Person even a warned row would print the very name the tag exists to hide. Elders and super admins still see them, since that is who the tag hides people from everyone else *for*.
- **On a Sunday, holding a liturgical Role should keep you out of a Servant Role on the same date.** You cannot preach and run the sound desk at once. Because the liturgy is stored as *fields on the Service*, not as Assignments, the picker reads that document to find out — and names the liturgical Role rather than hiding the person.
- **Once the date passes**: Confirmed becomes an [[Involvement]] automatically; Declined never does; Pending becomes an open question an editor resolves ("did they serve?"), and an unresolved question never counts as serving.

### Commitment
What a Person is **down for** — their own [[Assignment]]s across the dates ahead, in whatever state each one is. The member's word for what the model calls an Assignment, and the name of the screen they answer them on, reached from the "You in {month}" card on the [[Calendar]].
- **The one place a member acts.** Confirming, declining, asking for [[Cover]], sending and answering a [[Trade]] — all of it happens here. Every notification is a thin layer that lands you back on it and nothing else.
- **Liturgical Roles appear and cannot be answered.** They are fields on the Service rather than Assignments and carry no state at all (ADR-0018 §2) — being on the printed booklet is the commitment.
- A **Pending** Assignment is still a Commitment. It is what you are down for; whether you have answered yet is the state, not the noun.
_Avoid_: my roles, my places, my duties, upcoming serves

### Cover
Somebody else taking on an [[Assignment]] whose holder has **Declined** it. The decliner keeps the Assignment — and keeps sight of the Event (ADR-0018 §5) — until somebody actually takes it: **declining asks for cover, it does not hand the problem to an editor.**
- **Quiet or open, and the decliner chooses.** An open one joins the **cover list**, soonest first, readable by anyone the Event's [[Event visibility]] already admits. A quiet one is reachable only through a [[Trade]] its holder sends. A quiet one can be opened later — that is the escalation when nobody answers.
- **A `participant`-rung Event never reaches the list.** The list exists to reach people who are *not* in the Event, and at that rung there is nobody it could reach without leaking the very thing the rung protects.
- **Eligibility refuses here, unlike everywhere else** (ADR-0030). The list shows every open Assignment, including ones you may not take, with the reason and the button off — hiding them would make the list lie about how much the church needs. Your own [[Away]] is the exception: overruling it is you changing your mind, not the app disbelieving you.
- An editor filling the Assignment ends it, and every live [[Trade]] on it with it — and both people in each one are told why. The editor does nothing special: the cleanup hangs off the roster write, so it runs whichever door they filled the place through.
_Avoid_: the pool, pick-up list, open shifts, cover request

### Trade
An offer against an [[Assignment]] looking for [[Cover]], naming **one or more** of the offerer's own Assignments in return.
- **Two doors, one record.** The decliner invites up to **three** people at a time; anybody else may offer off the cover list uninvited, and inbound offers are **not** capped. Either way the holder accepts one of the Assignments offered, or refuses the lot.
- **Asking nothing in return is not a Trade — it is a take.** Taking needs no answer, and [[Cover]] already settles one in a single tap, so an uninvited offer must name something. The exception is a **reply to an invitation**: somebody who was asked and says "I will just take it" settles it there and then, because the holder already asked and the answer *is* the agreement. That reply still has to exist, since a **Quiet** Assignment is on no cover list and the invitation is the only way its existence reaches anybody.
- **Refusing is a button, never silence**, at both ends. The decliner may also withdraw an invitation — which is what makes inviting somebody with no [[Linked User]] workable, since they cannot answer in the app until MS-249 can text them.
- **Nothing is reserved while an offer sits.** One transaction settles it and re-reads every Assignment involved; if one has moved it fails and says so. Settling kills every other live Trade touching either Assignment and tells everyone named — silence is what makes people stop using it.
- **An Assignment arrives with no history**: Confirmed, since its new holder chose it, and the previous decline evaporates (ADR-0018 §5). Two people who are each stuck may therefore swap two declined Assignments and both walk away fine.
- **An ended Trade is a notice, not a deletion.** It stays on the [[Commitment]]s page in the past tense, saying what happened and why — settled elsewhere, filled by an editor, kept after all, or the place taken off the Event — until the person it happened *to* has cleared it. Whoever caused the ending is never told their own news back; where nothing in the conversation caused it, both parties hear. An offer that silently stops existing is how somebody concludes the app loses what you put into it.
- **It dies with the date.** No expiry, no reminder, no chasing — the date is the only clock. That sweeps the notices up too: one about a Saturday that has gone has stopped mattering, so nothing has to expire them.
- Distinct from a [[Swap]], which is an editor's move on an unsaved [[Auto-assign]] draft and writes nothing.
_Avoid_: swap, exchange, shift trade

### Quiet
A [[Cover]] that never reaches the open cover list: only the people its holder invites to a [[Trade]] can see it. The opposite is **open**, which is where every declined Assignment went before Trades existed.
- **Chosen at the moment of declining**, which is the only moment anybody is thinking about it, and a property of the [[Assignment]] rather than of the answer — so confirming and declining again does not quietly re-advertise it.
- **It can be pushed open later**, and that escalation is what makes quiet safe to offer: without a way out, choosing quiet would be choosing a dead end. Going back the other way is refused while somebody has an uninvited offer live against it, since they answered an advertisement in good faith.
- **The rung still wins.** An Event at the `participant` rung can reach nobody who is not already in it, so it is quiet whatever anybody chooses, and no choice is offered there.
_Avoid_: private, hidden, secret

### Warning
A note that the roster on an [[Event occurrence]] breaks one of the Role's own rules, shown wherever that roster is shown — the [[Roles tab]] and [[Auto-assign]] alike. **The editor is the final word**: a rule about the roster advises and never refuses *them*, because a tool that will not record the rota the church is actually running is a tool the rota leaves (ADR-0021).
- **Advisory to the editor, absolute to everyone else** (ADR-0030). The same rule that warns an editor **refuses** a member taking [[Cover]] or settling a [[Trade]], and refuses [[Fairness]] outright. The line is not human-versus-machine: it is whether the actor is the person whose rules these are. An editor overruling a restriction is overruling themselves; a member doing it is overruling the church, in a path nobody reviews.
- So a Warning is only ever something an **editor** (or drift) produced. The congregation cannot create one — which is why a traded Assignment is always legal at the moment it settles.
- Covers everything an editor authored: the **restriction rules**, the **allowlist**, a slot's male/female requirement, [[Role exclusivity]] and the two-Role limit, and the liturgical clash. It also covers the one thing a **Person** authored — somebody standing in a place on a date they said they were [[Away]] — which reads as their words rather than as a rule being broken.
- Does **not** cover who may be *shown*. An **Inactive**, [[Non-server]] or tag-hidden Person is not offered at all, and no roster rule reaches them — that is a rule about names on screens, not about rosters.
- **A property of the roster, not of the act.** It is judged from the roster as it stands, so a lineup that was fine when drafted and broke later — somebody married, a tag changed, a Role gained a rule — reports itself with nothing overridden. This is why it is not called an override.
- **Derived on read. Never stored, never dismissed.** The same warning returns every time the date is opened, which is deliberate: a warning you can wave away is one nobody reads by the third week.
- [[Fairness]] never creates one — it asks about eligibility and accepts the answer, so every draft it emits is clean. On [[Auto-assign]] a warning is always the editor's own edit.
- An **empty place is not a warning**. Leaving a place unfilled is a legitimate answer.
_Avoid_: override, violation, error, conflict

### One-off Role
A Role created for a single Event and living only on it — "someone to unlock the hall". Deliberately cheap: a **label and some people**, with no definition, no reuse, no slots, no restrictions and no eligibility checking. Forcing every ad-hoc job through the Roles Manager would make the Roles Manager a junk drawer.
- It still carries a [[Role intensity]] and a [[Role exclusivity]] toggle, both set **on the Event page** rather than in the Roles Manager, since there is no stored definition to hold them. Without them a one-off job would be free and unlimited, and the person who unlocks the hall would quietly absorb three more jobs the same morning.
- Its [[Involvement]] is written under **one reserved slug**, `one_off`, with the label in `metadata` — never an invented slug per job, which `RolesCore.roleBySlug` could not resolve to a name on any surface showing serve history.
- **Counts as serving** (the person who unlocks the hall every week is not someone who never helps), but is **never a Role to balance** — there is no rotating a job that happens once. So [[Fairness]] never *fills* one — but it always counts one, and the intensity set on the Event is what it counts. Anything less would record the hall-unlocker's serving and then hand them the coffee rota anyway.

### Event visibility
Who may see an [[Event occurrence]]. One of five rungs, set on the series or the one-off Event and **stamped onto every occurrence** — a security rule cannot afford a lookup per document (ADR-0018 §5, following MS-130).
- `public` — anyone, signed in or not.
- `member` — members and above.
- `participant` — only members holding a Role on **that** Event, plus everyone above. Checked against the occurrence's `participantIds`.
- `editor` — editors and above.
- `elder` — elders and super admins.
- Changing a series' visibility restamps **all** its occurrences, past ones included.
- **Removed by an editor → sight of the Event is lost instantly. Declined by the person → sight is kept until someone else takes the slot**, so they can still see what they turned down and change their mind.
- Whether a participant sees the Event's full **roster** is an editor's choice per Event. Firestore cannot hide a field from a reader, so the roster lives in a subcollection with its own rule.
- **The Sunday Service is permanently `public`** and not editable — its occurrences are what the congregant-facing Service Guide reads.

### Event Attachment
A file attached to one [[Event occurrence]] — a flyer, a sign-up sheet, a floor plan, whatever the date needs on hand. Stored in our own Storage under `event_attachments/{occurrenceId}/{attachmentId}/{fileName}`, one Firestore record per file in the `attachments` subcollection, the same shape a Directory Photo's `photoUrl`/`photoPath` pair uses (ADR-0029) but one document per file rather than one field per Person. Any file type is accepted, up to a size cap; there is no content-type restriction, because the point was accepting many kinds of file, not one.
- **Read like the Event itself, written like the roster.** Anyone who can already see the occurrence can see what is attached to it — the gate is the occurrence's own [[Event visibility]], not a separate sharing toggle — but only an editor may attach or remove one. Shown on its own **Files** tab, apart from the Event tab and Attendance.
- **Fetched, never linked** (ADR-0046). The record holds the storage path; there is no URL anywhere, because a Storage download link serves the file to anyone holding it, signed out, forever. The browser downloads with the reader's own credentials, so the visibility rule is asked on every read — and the Storage rule reads the occurrence to answer it, rather than settling for "is anybody signed in".
- **Shown here, or saved — never handed to Google** (ADR-0047). Clicking an attachment opens it inside the Event page when the browser can draw it (a PDF, a picture, a Word file, a .csv, a sound or video file) and saves it when it cannot. It is drawn out of the same blob the reader already fetched, so no second read and no link. Docs, Sheets and Drive's own previewer are impossible here by construction: they open a file by fetching it from an address anyone could read, which is the one thing an Event Attachment must never have.
- **Deleting removes the pointer, not the bytes.** A client is never trusted to delete the blob directly — `cleanUpDeletedAttachment` removes it once the Firestore record is gone, mirroring `cleanUpReplacedPhoto`.
_Avoid_: file, upload, document (this app already uses "document" for an Elder Document — use Event Attachment for this concept)

### Event Document
A document WRITTEN in Mosaic and belonging to one [[Event occurrence]] — an agenda, a running order, a set of minutes — as opposed to an [[Event Attachment]], which is a file uploaded from somewhere else. Both are listed on the Event's **Files** tab, and the difference a person sees is what happens when they click: an Attachment is fetched and shown or saved, a Document opens in the editor.
- **The same Note Body as everything else** (ADR-0049). Stored as TipTap JSON in `event_occurrences/{occurrenceId}/documents/{documentId}`, the same shape an Elder Document uses, edited in the same [[Note Module]], exported to Word by the same walk. What differs between the two is where it hangs and who may read it — never the content shape or the editor.
- **Read like the Event, written like the roster.** Anyone who can see the occurrence can read its Documents; only an editor may create, rename or delete one — the same gate the Attachments subcollection uses, and for the same reason.
- **No Cross-References.** The Note Module's @-mention picker points at elder-only records, and an Event Document may be readable by any member. The picker is off here.
_Avoid_: Event note (Shepherding Note owns "note"), Event file (an Attachment is the file)

## Shepherding System

### Elder Document
A text document created and managed by elders, stored in the `elder_documents` collection. Replaces and generalises the former `elder_meetings` concept. Created either in the Document Library, where it belongs to no Person, or on a Person's Shepherding Profile, where it does (ADR-0015).
- **Fields**: `title`, `contentJson`, `authorName`, `authorUid`, `createdAt`, `updatedAt`, `updatedByName`, `docType` (optional, defaults to 'note'), `filterId` / `filterConfig` and `careListData` (for care-list type), `ownerPersonId` and `inLibrary` (profile scope only).
- `docType`: Can be `'note'` (standard TipTap document) or `'care-list'`.

### Author
The Elder an Elder Document is written by, recorded as `authorUid` and `authorName`. **Every Elder Document has one**: a document whose author cannot be resolved is refused rather than written, because an untraceable pastoral record is worse than a create that failed — it exists, it stands in the Pastoral Record, and nothing surfaces the problem. Distinct from `updatedByName`, which is whoever touched it last.

### Care List
A type of Elder Document that displays a filtered list of people. The first column shows the person's name (sticky); additional elder-defined columns scroll horizontally and allow editing person attributes inline — including applying or removing Shepherding Tags (`#` / `-#` triggers) and setting the Shepherding Status (`$$` trigger, which spawns the status matrix inline). Status changes made via `$$` generate a Status Change on the person's Pastoral Record. Unlike Shepherding Notes, Care List cell content is private to the Care List document and does not sync to the person's Shepherding Profile.

### Care List Editor
The interface for a Care List document. It presents the filtered list of people and a dedicated rich-text editor for each. A single shared toolbar at the top provides formatting tools for the currently focused editor. Changes are saved automatically on edit.

### Document Library Access
All elders and super admins have equal create/read/update/delete access to all Elder Documents and the folder structure. The `isElder()` Firestore rule (`['elder', 'super_admin']`) covers the entire Document Library — no per-author restrictions.

### Document Library
The collection of all Elder Documents together with their folder organisation. Consists of two things in Firestore: the flat `elder_documents` collection (one doc per document, keyed by ID) and a single `elder_document_structure` document that encodes the full folder tree. The tree node carries folder names, child folder nodes, and ordered lists of document IDs — it does not duplicate document content.

Two pages serve the Document Library:
- **`shepherding-documents.html`** — the file directory. Displays the current folder's contents (sub-folders and documents). Navigating into a folder updates the view in place (drill-down); a breadcrumb trail shows the path and allows navigating back up. Double-clicking a document navigates to the document page.
- **`shepherding-document.html?id=...`** — the document editor for a single Elder Document. Always in edit mode: the title is an editable input and the TipTap editor is always active. Saves automatically after a debounce (1–2 seconds of inactivity); a status indicator shows "Saving…" / "Saved". Contains a back link to return to the Document Library.

### Folder
A named node in the Document Library's tree. Folders can contain other Folders (arbitrary depth) and Elder Documents. Folders exist only inside the `elder_document_structure` tree — they are not separate Firestore documents. Moving a document or folder means updating only the structure document, not the document itself.

Reorganisation is supported two ways: drag-and-drop within the directory view (primary), and a "Move to…" dialog that presents a folder-picker (fallback, accessible from the hover action row on each item).

Renaming is inline for both folders and documents: clicking the rename icon (or double-clicking the name) turns the name into an editable input in place. Pressing Enter or clicking away saves the change.

Creating a new document or folder follows the same inline pattern: the item appears immediately in the current folder with its name field already in edit mode (text selected), ready for the elder to type the name. No modal, no navigation. The elder double-clicks to open a document only after naming it.

Deleting a non-empty folder requires a confirmation dialog that lists the count of affected documents. On confirmation, all contained Elder Documents (at any depth) are deleted from Firestore and the folder is removed from the structure tree.

### Status Change
A record in a Person's Pastoral Record capturing a Shepherding Status transition. Stored in a sub-collection under the Person. Fields: previous status, new status, author name and UID, source (`profile` | `people_list` | `document`), optional source document ID, timestamp, and an optional Explanation. The Person document retains a denormalized `shepherdingStatus` field for list/filter queries; that field and the Status Change sub-collection are always written together.

### Tag Change
A record in a Person's Pastoral Record capturing a Shepherding Tag being applied or removed. Stored in the same sub-collection as Status Changes. Fields: tag ID, tag name, action (`added` | `removed`), author name and UID, source (`profile` | `people_list` | `document`), optional source document ID, timestamp, and an optional Explanation.

### Shepherding Note
A rich-text note attached to a specific Person (stored in `people/{id}/shepherding_notes`). Distinct from an Elder Document — a Shepherding Note is person-scoped context; an Elder Document is board-level, standalone content.

A Shepherding Note may be created from within an Elder Document via a Person Panel. In that case it carries a `sourceDocumentId` back-reference to the originating Elder Document. The person it belongs to can be reassigned (re-associated) — when that happens the note moves to the new person's sub-collection; the old person's profile loses it.

Sync between a Person Panel and its linked Shepherding Note happens on Elder Document save (the existing 1.5s auto-save debounce). The profile page reads the note's latest Firestore value on load — no real-time listener is held across pages.

On the profile page, a panel-created note displays a subtle "From: [Document title] →" link in the note card footer, linking back to the originating Elder Document. This is the only visual distinction from a manually created Shepherding Note.

### Person Panel
An embedded block inside an Elder Document's TipTap editor that is linked 1-to-1 with a single Shepherding Note. Inserting a Person Panel creates (or links) the Shepherding Note immediately. Editing the panel's body syncs to that note on document save; editing the note on the person's profile is reflected in the panel on next document load. The panel's header shows the Person's name and is editable — changing it re-associates (moves) the linked note to the newly selected Person.

**Visual design:** A fully bordered card with a `surface-container` header background containing the person's name (editable, acts as person picker) and a note type selector (defaults to 'Elder Meeting'). The body is a `surface-container-lowest` (white) content area below the header — a TipTap sub-editor. No subject field.

**No subject field** — the person name and document title together provide sufficient context.

When a Person Panel is deleted from a document, a dialog asks whether to keep the linked Shepherding Note on the person's profile (it becomes a normal unlinked note) or delete it entirely.

The panel header contains: the Person's name (editable, re-associates the note on change) and a note type selector (same options as Shepherding Notes, defaulting to 'Elder Meeting'). 'Elder Meeting' is a new note type added to the existing set: `['Elder Check-in', 'Elder Interview', 'Elder Meeting', 'Life Update', 'Other']`.

Inserted via: slash command (`/person`) or a dedicated toolbar button. Both open a Person picker with two modes:
- **New note**: creates a fresh Shepherding Note linked to the panel.
- **Link existing note**: pulls an existing Shepherding Note for that Person into the panel; the panel body is populated with the note's current content and syncs from there.

Multiple Person Panels may exist in a single Elder Document, including multiple panels for the same Person — each is linked to its own Shepherding Note (new or existing).

### Mention
An `@`-prefixed inline reference inside a TipTap editor. The mention system spans three pages (shepherding profile, elder document editor). Mentionable kinds: Person, Shepherding Note, Elder Document, Folder. The autocomplete groups results by kind. Formerly referenced `elder_meetings`; that kind is replaced by `elder_document` and `elder_folder`.

## Editing together

**Service guide party**:
The evening the men of the church sit down together and write the orders of service for the next couple of months. The case the three conventions below exist for — many people editing Sundays at once, in one room. Everything here is judged against it: a dozen editors, a handful of documents, and the people concerned close enough to speak to each other.

**Element authorship**:
Who decided each element of a Sunday — a small tag under each row on the **Order of Service** page saying who chose that hymn, that call to confession, that benediction. Stored as `decidedBy`, keyed by the same liturgy field name as the value itself. ⚠ **Recorded on every surface that can decide an element, shown on one**: a hymn picked in the [[Planning view]] is just as decided as one picked on the Order of Service page, so both stamp it, but only the Order of Service draws it — the Services page is for doing the work rather than reading who did it. Recording in only one place would make the tag a liar, and a *missing* tag reads as "nobody has chosen this yet" rather than "we did not write it down". The stamp rides in the **same write** as the value it describes, so a half-failure cannot leave a hymn nobody appears to have chosen or a name against a hymn that never saved. **Clearing an element clears its author** — and does so whether or not we can say who cleared it, because a tag left over an empty row claims somebody chose the emptiness. Not an [[Involvement]]: deciding a hymn is not serving.

**Box lock**:
One person per box, refused at the door ([ADR 0035](docs/adr/0035-one-person-per-box.md)). A box another editor holds does not open — it has no editor to click into, and carries their face and first name instead. Two people are therefore never in one box, so there is never a version to choose between; the conflict is prevented rather than resolved, which is what buys the absence of any merge, transform or "yours or theirs?" dialog. A claim is a **heartbeat, not a flag**: it expires after 30s and beats every 10, because a lock that outlives its holder would leave a shut laptop holding a hymn hostage on the one evening everyone is in a room to work. Held per **field path**, so a lock **crosses surfaces** — a hymn claimed in the [[Planning view]] is locked on the Order of Service page too.

**Presence**:
Who else is on this page, drawn as a row of faces. Lives at `presence/{uid}` — one document per editor, named after them, which is what lets the rules say *write your own and nobody else's* and makes the [[Box lock]] enforceable rather than merely agreed. Scoped to **surface and page**: "also here" must mean *here*, or a man reading the Services page appears to be sitting on a Sunday he never opened, and a badge that is wrong is worse than one that is absent. ⚠ **Presence may remove a lock; it may never remove an editor.** It starts late, after sign-in, and both pages once started it from inside the handler that grants editing — so a throw inside it turned the application read-only and looked like a styling bug. Starting it cannot throw at its caller, editing rights are granted *before* it starts, and with it not running every box simply opens.

**Live updating**:
Both the **Services** page and the **Order of Service** listen to Firestore for as long as they are open, rather than reading once on load. A change to a field nobody on this screen has touched is simply adopted; a field this editor has changed is left alone until it saves — which needs no merge and asks nobody a question, because the only case that could need a decision is the one the [[Box lock]] prevents. An adopted value moves the **saved snapshot** with it, or the next save reads it as a local edit and writes it straight back, turning something received into something claimed. A snapshot landing mid-edit never rewrites the box under somebody's hands: every inline editor hides its cell and puts an input in its place, so **a hidden cell is somebody editing** — a signal that cannot drift out of step with what is on screen.

## Reaching a Person

### Notification — MS-189
One message to one Person, sent by whichever channel can actually reach them. **The caller says who and what, never how**: a prayer ask, a [[Trade]] offer and a nudge all call one path, and none of them knows whether that person owns a phone with Mosaic on it. Push to the app if their [[Linked User]] holds a live [[Device token]]; a **text** through Textbelt if they hold none.
- **Push needs an account; a text does not.** A token belongs to a signed-in User, so a Person with no [[Linked User]] can only ever be texted. That is the fallback's ordinary cause, not its edge case.
- **Whether a push landed is not knowable, and nothing pretends it is** ([ADR 0036](docs/adr/0036-a-notification-picks-its-channel-and-delivery-is-best-effort.md)). A revoked permission and a flat battery look exactly like a delivered message. So delivery is **best effort**: no token means text now; a token the provider rejects is deleted and the message texted now; a token the provider accepts ends the matter. **The feature's own second chance is the escalation** — pastoral prayer already re-asks at three days if the request is still empty, so the first ask goes by push and the re-ask by text. An unanswered request is a truer signal than any delivery receipt, and it is already written.
- **It carries a URL, not a screen name.** One string that a push, a text and a browser all understand: the app parses its path into a route through the mobile shell's `nav()`, and a text carries the same link for a browser because a text has no shell to talk to. **A Mosaic link in a text opens the browser, not the app** — Universal Links and App Links are a **deliberate non-goal**, not a later phase.
- **Logged once per send, in `notifications`** — Person, channel, purpose, and whether the provider took it. This is what ADR-0009's `sms_messages` becomes now that a text is one channel rather than the only one. Correlating an inbound reply to the message that prompted it stays a *field* on the row and an SMS-only concern: a push has no reply.
- **It obeys the church's hours** — 8am–8pm church-local, the same window and the same code the prayer texts already use. A push at 6am is worse than a text at 6am, because a text waits quietly.
- **A Person with no Device token *and* no phone number cannot be told anything by anybody**, and an editor is shown so. Nothing else about delivery is surfaced: the Prayer Request already reads as filled or unfilled, and that is the honest signal.
_Avoid_: alert, reminder, message (unqualified), and **push** / **SMS** for the thing itself — each is one channel of a Notification

### Device token
The handle one signed-in device is reachable at, held in `users/{uid}/push_tokens/{id}` — on the **User**, never on the [[Person]], because it belongs to a phone somebody signed in on and one person has a phone *and* a tablet. A send addressed to a Person resolves through the existing `people.userId` link. Rewritten on every launch that has permission (the provider rotates them unasked), deleted when the provider rejects it, and **deleted on sign-out** — leave one behind and the next person to sign in on that phone gets the last person's pastoral prayer on their lock screen.
_Avoid_: FCM token, device id, registration, push subscription

### Notification permission
The one OS prompt asking whether Mosaic may notify this phone. **Asked once, and only after a Mosaic-owned explainer** on the phone's home once somebody is signed in and linked — never on first launch. iOS gives exactly one prompt: denied is denied, and the only way back is talking somebody through iOS Settings, so spending it on a stranger who has not yet seen what Mosaic does is spending it badly. A permanent toggle in settings is the way back afterwards. Mosaic keeps **no preferences of its own** on top of it — no per-kind opt-outs — because with one thing sending Notifications that is a settings screen with one row; revisit when there are genuinely different kinds to choose between.
_Avoid_: opt-in, subscription, notification settings

## Forms and Registrations — MS-173

### Form Template
The definition of a form: a title and **one ordered list of questions**, each carrying a response type and optionally **required**. Built and owned by **editors and above**, in the [[Forms library]]. A template is never the thing somebody fills in — it is what the filled-in thing is made from.
- ⚠ **A [[Section heading]] is one of those questions, not a structure around them.** This entry used to read "an ordered set of sections and questions", which suggested a grouping layer that has never existed and is not wanted. There is one list.
- **The title is capped at 90 characters.** Whoever opens the link reads it first, and it has to survive a phone. The cap is in the model, not in the text box.
- **Questions stay editable after publishing**, because a sign-up whose wording cannot be fixed is worse than one that changes under you. But editing a form that already has [[Response]]s **says so before it saves**, and a question carrying answers is never deleted — it is retired, so the tally it already gathered survives. There is no template versioning: an edit does not migrate answers already given.
_Avoid_: form (unqualified — the template is what is built, a [[Form Document]] and a [[Response]] are what it makes), survey, questionnaire

### Section heading
A [[Form Template]] entry that **asks nothing**. It carries text and renders as a heading on the fill-in page, marking where one part of a form ends and the next begins — which is what a form needs when it is acting as a structured document rather than a survey.

It is a **question type**, sitting in the same ordered list as every other question and reordering with them. It is deliberately **not** a grouping structure: nothing nests inside it, and adding one does not reshape a template.

Three things follow from asking nothing, and all three are enforced in the model rather than only hidden on the page:
- It can **never be marked required** — "Needed" on something that takes no answer is a form nobody can submit.
- It **produces no key in a [[Response]]**. Anything sent against one is dropped.
- It **never appears in the tally**. Left in, every form with a heading would report a question nobody answered.

It is also not numbered on the fill-in page, and does not count towards "9 questions" — a count that included headings would be a promise the form does not keep.

_Avoid_: section (unqualified — it names a structure this does not have), group, page break

### Form Folder
A named place a [[Form Template]] can be filed in, in the [[Forms library]]. Folders nest to any depth. Editors and above may make, rename, move and delete them; nobody below may read them.

**A form remembers its folder; a folder does not remember its forms** ([ADR 0054](docs/adr/0054-a-form-remembers-its-folder-a-folder-does-not-remember-its-forms.md)). This is the one place the Forms library deliberately parts company with the [[Document Library]] it is otherwise modelled on: that page keeps its whole folder tree in a **single record** and rewrites it whole, which is safe for a handful of elders and wrong here for two reasons.
- The Forms library is open to **editors**, who are many. Two filing at the same moment would both write the whole tree, and the second would silently discard the first.
- A form's id is a **public address**. A form that fell out of the shared tree would still be taking answers while nobody could find it to close it.

So the library lists the `forms` collection exactly as it did before folders existed. **Filing changes where a form is drawn, never whether it is**: a form nobody filed sits at the top level, and one whose folder has been deleted comes back there.

On screen it is the Document Library's behaviour, deliberately — inline creation with no dialog, drag to move with a **"Move to…"** fallback, rename in place, and the one confirmation on the page before a full folder goes, **naming how many forms go with it at every depth**. The count is what makes the question answerable.

_Avoid_: form tree, form structure (both name the storage this deliberately is not)

### Forms library
The page the [[Form Template]]s live on, and **a place you navigate into rather than a list you pick from** ([ADR 0053](docs/adr/0053-the-forms-library-is-a-place-you-navigate-not-a-pane-you-pick-from.md)). A full-width list; opening a form goes to the form's own page carrying its questions, its settings and its responses. Modelled on the [[Document Library]], which is the closest sibling this feature has — not on the [[Roles Manager]]'s split pane, which cannot hold a folder tree beside an editor and would have to be thrown away the moment folders arrive.
- **Folders arrived with MS-361.** The breadcrumb has depth, every level navigates, and every level takes a drop — dragging something onto `Forms` is how it comes back out of a folder. See [[Form Folder]].
- Carries a **search across every form**, and a **hide-closed** toggle that is **on by default** — a [[Closed]] form is a record, and this page is a working list. What is folded away says so, and says the links still work.
_Avoid_: forms manager, forms dashboard, the forms pane

### Form Mode
What a [[Form Template]] produces, chosen when the template is made. The spine of MS-173, and the reason several settings exist on one side of it and are meaningless on the other.
- **`document`** — filled in **once**, and the filled-in thing *is* the record. Lands in a document library like anything else written in Mosaic. The Elder Interview is the case. The same template is deliberately used many times by the same person, each time producing a separate [[Form Document]].
- **`responses`** — **published** to a link, answered by many people, read as a tally. The church poll and the bible-study sign-up.
_Avoid_: form type, template kind, output type

### Response
One person's answers to a `responses`-mode [[Form Template]]. Counted on the **Responses tab**; never shown to the person answering (see [[Answering rung]]). Distinct from a [[Form Document]], which is a record rather than a data point.
- **A Response may be partial.** Only *required* questions must be answered, so "four of five questions" is an ordinary Response and not a broken one.
- **The Responses tab changes shape with [[Attribution]].** An anonymous form has no people to list, so it leads with the per-question tally. An attributed form leads with **who answered**, one row each, opened one at a time — two answers are a list of people, not a chart — and the tally sits a tab away.
- **An anonymous answer's handle is positional, never chronological** ([ADR 0052](docs/adr/0052-a-secret-ballot-keeps-two-lists-that-cannot-be-joined.md)). Answers are read back in a stable shuffle keyed by the form, so "answer 6" means the same thing to two elders reading at once and says nothing about when it arrived. **No timestamp is shown against an anonymous answer at all** — not a date, not "3 days ago". An attributed answer keeps its timestamps; it already says who gave it.
_Avoid_: submission, entry, result

### Answering rung
Who may answer a [[Form Template]] — `public`, `member`, `editor`, `elder` — reusing the [[Event visibility]] ladder rather than inventing a second one. **`public` is the only rung that needs no account**, because proving you are a member requires one; "is sign-in required" is therefore not a separate switch, it is read off the rung.
- **A `public` form is link-only and unlisted** ([ADR 0051](docs/adr/0051-a-public-form-is-served-and-answered-through-one-closed-door.md)). You can open a form whose link you were sent; you cannot ask what forms exist, and an id is not guessable.
- **A signed-out person never touches Firestore.** One Cloud Function hands out the questions and takes the answer, and `firestore.rules` gains nothing — the public path is a door with somebody standing in it, not a hole in the wall. Public submissions pass an invisible bot check (App Check).
- **A form's link carries a random token, never its title.** `/f/7bQm2xK9vRt4Lp8sYw3NcF` — 128 bits, base58, stable for the life of the form. A readable slug like `/f/monday-food` is a *guessable* slug, and derivable from the form's own name, which is the enumeration the closed door exists to prevent. The form page carries a **copy-link row**, because you come back on Thursday and want the link again.
_Avoid_: visibility (that is [[Event visibility]]'s word for an Event), audience, access level, slug

### Attribution
Separately from the [[Answering rung]], whether a [[Response]] records **who** gave it. On a signed-in rung that means stamping the [[Person]]. On `public` there is no Person to stamp, so a name is a *question on the form* like any other — the form asks, rather than Mosaic knowing.
_Avoid_: anonymous (as the field name — attribution is the setting, anonymous is one of its values), named, identified

### One Response Each
A [[Form Template]] setting: may a person answer more than once. **Only available on `member` and above**, because a `public` form has no account to key on and half-enforcing it with a browser cookie would be a promise the thing cannot keep. **Only meaningful in `responses` [[Form Mode]]** — a [[Form Document]] is filled in repeatedly by the same person on purpose. A member who has answered may go back and **change** their answer until the form closes; they never get a second one.
- **It combines with [[Attribution]] off to make a real secret ballot**, and the two lists that requires may never be joined ([ADR 0052](docs/adr/0052-a-secret-ballot-keeps-two-lists-that-cannot-be-joined.md)): the answers carry no person, the ledger carries no answers, and timestamps are coarse because millisecond ordering would line them back up. The form says so in its own words — *we record that you answered, we do not record what you said* — because the promise the church hears must be the one the storage makes.
_Avoid_: single submission, one vote, unique response

### Closed (a form)
A `responses`-mode [[Form Template]] that has stopped taking answers — pressed shut by an editor, or reached the **closing date** set when it was published. A closed form's link still works and shows the form's **title and when it closed**, never the questions and never the tally: a working link that renders as not-found reads as broken and generates a phone call, and showing the tally would hand every answer to whoever holds a forwarded link. Closing also ends a member's right to change their answer.
_Avoid_: expired, archived, disabled, locked

### Answering a form
What the person filling one in sees. They get the questions, and on submitting they get **a thank-you and nothing else** — never the running tally. Showing the split changes what later people answer, which quietly ruins the poll being run, and on a `public` form it would let a stranger holding a forwarded link read everybody else's answers.
- **Nobody is notified when an answer arrives.** The Responses tab is the inbox and an editor goes and looks. Pushing an answer at a named person is real and wanted — MS-271 needs it — but it is its own ticket, not part of proving a stranger can answer safely.

## User Interface Conventions

### Autosave
**A page editor saves itself; a dialog keeps its button** ([ADR 0032](docs/adr/0032-a-page-saves-itself-a-dialog-does-not.md)). The line is whether you are looking at a record or at a form proposing one: a page editor is already open on something that exists, so every edit is a further fact about it, while a dialog's Cancel is what makes it safe to open — and most dialogs here double as the way a thing is *created*, where there is no record to write into yet. Autosaving surfaces: the **Order of Service**, both **Service Guide** editors, your own details on the **profile page**, and — since [ADR 0004](docs/adr/0004-person-panel-sync-model.md) — **Elder Documents** and the **Care List**. The debounce is **1.5s** everywhere except the Order of Service, which waits **3s** because its save also settles [[Involvement]] and re-runs [[Fairness]]. The **Save button stays** on every autosaving surface and means "write it now" — it cancels the pending timer. A status chip carries the state (Unsaved changes → Saving… → Saved). A **failed autosave is silent** (the chip goes back to unsaved and the next edit retries); a save you pressed still reports its error, and never re-arms itself, because retrying a refused write on a timer is a loop with no end.

**A Sunday saves the fields you changed, not the Sunday** ([ADR 0034](docs/adr/0034-a-sunday-saves-the-fields-you-changed.md)). The Order of Service used to send its whole in-memory copy on every autosave, so with two editors on one Sunday the second timer to fire wrote a minutes-old blank over the other's hymn — silently, because from Firestore's side a stale blank is an ordinary field write. A save now diffs the loaded snapshot against the current one and writes dot-path updates for the difference only; a slot nobody touched is not in the write, so it cannot lose a race it never entered. The unit is the **liturgy slot**, not the leaf inside it, because a hymn's id and name are chosen as one act. Dot paths require `update()` — `set(merge)` would read `liturgy.hymn1` as a field *name* containing a dot and build a second liturgy beside the real one. Autosave made the old behaviour worse rather than better: a button fires when somebody decides they are done, a 3s timer fires while they are still thinking.

### Services
The week-by-week view of Sunday **Services** — the Sunday Service series and nothing else. **Renamed from "Service Calendar"** (MS-99): unchanged in function, renamed so it is not confused with the [[Calendar]], which is a different view.
- **Planning view**: the Table View opened out to every liturgy slot, for writing many Sundays in one sitting — the shape a [[Service guide party]] needs, where you fill one hymn slot down twelve weeks rather than opening twelve Sundays one at a time. A button bottom-right folds the **Directory** back to a rail, releases the page's reading width, and reveals a column per element in liturgical order, so reading a row left to right reads the service. Each column is inline-editable; hymn cells search the same index the Order of Service uses, and the two scripture columns open the same verse picker. The columns are **in the markup either way and revealed by a class** — toggling by re-render would take away the box somebody was typing in. The rail's arrow swings the Directory out as a **drawer lying over the table** (pushing would shift every column sideways each time somebody checked a date) and shuts again on a click; the way out of the view is the button that says so. _Avoid_: Spread, Grand view, hyper mode.
- **Assigned**: who agreed beforehand to *write* a given Sunday's order of service — a badge at the leading edge of each row in the Planning view, showing their photo with their first name under it. Stored as `assignedWriter`. ⚠ **Not a [[Role]] and not an [[Involvement]]**: everywhere else on this page putting a person on a Sunday means they *served*, which writes an involvement record and moves their number in [[Fairness]]. Volunteering to fill in a planning row is not serving, and crediting it would make whoever takes the most Sundays look over-used and stop being asked. Deliberately short-lived — [[Element authorship]] is what replaces it, which is why the field is named for the writer rather than the vaguer "assigned to".
- **Baptism Indicator**: 
  - **List View**: A blue status badge with a `water_drop` icon.
  - **Table View**: A dedicated "Baptism" column showing the Baptism Candidates' names.
  - **Editing**: Read-only in the calendar; Baptism Candidates are managed in the Order of Service editor (linked to Person records). In the legacy system the "Include Baptism?" toggle sets `hasBaptism`; in the new system `hasBaptism` is derived from whether the week's Service Guide Template requests the baptism component (ADR-0010).
- **Sermon passage**: shown in **both** views — its own column in the Table View, and a `menu_book` line under the theme in the List View. It carries as much of "what is this Sunday" as the theme does, so a view that hides it is answering the question half-way. It reaches the phone's services list and both **Sunday at a Glance** panels for the same reason.
- **Editing Summary**: 
  - Baptism Candidates are linked to People and editable from the Order of Service editor (read-only in the calendar).

### Calendar
The view over **every** [[Event occurrence]] the signed-in person is allowed to see, not just Sundays (MS-99). Editors and above create Events here; what each person sees is governed by [[Event visibility]].
- Distinct from [[Services]], which shows Sundays only and remains the surface for editing a Service's liturgy.
- Loads with **two queries merged client-side** — one filtered by the viewer's rank, one `array-contains` their Person id for `participant`-visible Events. Firestore cannot express that as a single filter, and an unconstrained query **errors outright rather than returning fewer rows** — a failure that looks exactly like "this church has no events". The same trap is documented in `firestore.rules` for the relationship collections.
- **Signed out is not an empty month, and the two look identical unless the page says so.** A signed-out Calendar still draws, because the Sunday Service is fetched **by id** regardless of who is asking while every other Event is filtered by the rungs the viewer's rank may see. So a lapsed session renders as a church that holds a service on Sunday and does nothing else all week. Both Calendar pages say when nobody is signed in and offer the way back; the phone app asks for a sign-in on launch rather than opening on a stranger's home screen (**"continue as guest" is remembered**, or the redirect would undo it).
- **On a phone it is a different screen, not a narrower one.** Seven columns across 390px gives about 50px a day, which fits a number and nothing else — so inside the mobile shell the desktop grid, toolbar and rail panel stand down and the phone draws its own: *Upcoming* in navy at the top, then the **month strip**, then the day or the month underneath it. Swapped on the shell rather than on a media query, because the same 390px window on a desktop still has a mouse and gets the desktop screen.
- **The personal card is *Upcoming*, and it is anchored to today, not to the grid.** It was *You in July* — the browsed month — which answered a question nobody asked: a serve already done sat in it as though it were still to do, and paging the grid back to April changed what you were down for. Now it runs from today over a window you pick (**next week / next 2 weeks / next month**, two weeks by default), which crosses the end of the month more often than not — so it takes its own read rather than sharing the grid's, and ignores **Only mine** and the **Show** ticks. Those govern the grid; a serve of your own is not something a display filter over a different stretch of time should be able to hide from you. What went wrong in the past still belongs to **Needs sorting**, which only speaks once the date has passed.
- **A place still to fill is not the same alarm as somebody saying no.** An editor sees, on the grid and in the list, how many **places to fill** each date ahead still has — a place being open when nobody is in it *or* when the person in it declined. One rule covers both, so the warning comes back by itself when somebody pulls out, with nothing having to remember it was ever cleared. It is said **on the chip and nowhere else** — a `--warning-container` background and a small `warning` glyph — because the chip is what you click to fix it, and the corner of a day cell already says the one thing a *day* can say. Amber, never the error red: **red is spoken for**, every future date has open places at some point, and in red the colour that means "somebody said no" would stop meaning anything. The amber is the same one an Event can be painted, which is not the clash it looks like: **a chosen colour only ever draws the bar down the side of a chip, and a tint only ever fills the background** — so a tinted chip always means the app is saying something rather than an editor having picked a shade. The "you" dot reads off `mine` rather than off the chip's kind, or an amber chip would swallow it. Editors only — a member cannot fill a place, and a count they can do nothing about is weather.
- **The count cannot be stamped on a date.** It depends on the Roles the [[Event series]] carries *today* and on each Role's slots, so a stored flag would go stale the moment a Role was added to the series — and the dates with the most to fill are precisely the [sparse](#event-occurrence) ones that have no document at all. So `loadCalendar` stamps `seriesRoleSlugs` at read time (stripped on the way back out, exactly as `seriesColour` is), and an editor's read brings back the rosters of the dates from today on that **already have somebody on them**. A date nobody is on needs no read: every place on it is open by definition.

### Recurring Events
The list of every [[Event series]] the signed-in person may see — the room the series live in, replacing the Calendar's old single "Sunday Service" button, which was the only door to the only series anybody had and did not survive the second one. Reached from the Calendar's header, at `recurring-events.html`.
- **One pane, two roles (MS-287).** Picking a series opens the same tabbed pane whoever is looking — it used to fork into an editor's four-tab pane and a plain member's separate flat list, which was how the editor's "The next few" card and the member's own list ended up saying the same thing on two different screens. Now `tabs` filters by role instead of the page forking:
  - **Dates** — everyone's. Each upcoming occurrence as its own card (styled like the [[Services]] page's List View), with a button through to that occurrence's own Event page. Fixed to today forward — it does **not** move when an editor pages the Rota tab's own window, which is a separate read (`upcomingOccurrences`, kept apart from the Rota's `occurrences` on purpose).
  - **The Event** — everyone's. The series' pattern, time, place, description and colour. Read-only for a member (plain text, no inputs, no save controls); an editor gets the same fields as editable, plus **Change pattern**.
  - **Rota, Roles & rules, Who can see it** — editor-only, unchanged. The rota grid ticks columns for [[Auto-assign]] and [[Blank draft]]; Roles & rules is where [[Cross-Role Rule]]s are written; Who can see it sets the series' [[Event visibility]] rung.
  - Both roles land on **Dates** by default now — a member's old effective default ("Coming up"), and, since review on the ticket, an editor's too rather than Rota.
- Each role sees only the events its own rank may see: the series read is constrained by [[Event visibility]] like every other, so a member's list simply does not contain the elders' meeting.
- **Almost read-only, deliberately** — everything on the grid has a screen that owns it, and a fourth surface that half-edits a roster is how two of them start disagreeing about the same Sunday. The one write over the *roster* is **emptying the ticked dates**, which earns its place because it is the only change that reads across a run rather than down a single date.
- **[[Cross-Role Rule]]s are written here, under the grid.** Not an exception to the line above: a rule about a pair of Roles is a fact about the **Event**, not about either Role and not about any one date, so this is the screen that owns it rather than a fourth screen borrowing it. The [[Roles Manager]] cannot hold it — a Role Definition travels to every Event that runs it, and this rule is only true where both Roles run together.
- **A series' page comes back here, not to the Calendar.** The Calendar draws dates, and a pattern is not a date, so it has no chip to arrive from — a series is only ever reached from this list, and sending it back to the Calendar ended the journey somewhere that could not show the thing just left. One **date** still belongs to the Calendar. Creating a recurring Event lands here too, opened on the one just made.

#### Month strip
The phone's month: seven columns of day numbers, each carrying up to **three dots** — one per Event on that day, in the Event's own `colour`, with the needs-sorting red overriding it exactly as a chip's bar does. A glance, not a list: the count lives in the cards underneath. Tapping a day shows that day; tapping into a neighbouring month's corner goes to that month, because those dates are not loaded and drawing "nothing on this day" for one of them would be a lie rather than an empty day.

### Service Analytics
The read over the whole history of the church's services — hymn usage, a Bible heat map, each Person's serving history, and who has been the pastoral-prayer subject and when. At `analytics.html`, reached from a dashboard card.
- **Editors and above.** It turns the service record into *who has served, how often, and when they last did* — a planning tool for the people who staff Sundays, and a different thing from a member reading the rota. The card is injected behind the same gate rather than sitting in the page, because a card in the markup is a card a member clicks and is refused on arrival.
- **The refusal lands before the read, not after the draw.** A page that assembles every Person's serving history and then declines to render it has already handed it to the browser.
- ⚠ **A door, and the lock behind it sits lower.** `people` and `involvement` need an account since [ADR 0031](docs/adr/0031-the-directory-asks-for-an-account.md), but this screen is editors-and-above — so a member who types the URL is stopped by the screen and by nothing else, and could still assemble the same picture with a query. (`services` stays world-readable: the congregant-facing Service Guide is on the other side of it.)
- People carrying a tag with `hidePeople` are filtered out of the People's Involvement table for anyone below elder — the same per-tag visibility the [[Membership Directory]] honours.

## Flagged ambiguities

- **"Calendar"** meant the Sunday-only Service Calendar before MS-99. It now means the all-Events [[Calendar]]; the Sunday view is [[Services]]. Code, labels and docs saying "Service Calendar" refer to Services.
- **"Assignment" vs "Involvement"** were the same act before MS-99 — assigning someone wrote a serve record immediately, even for a future date. They are now distinct: [[Assignment]] is the plan, [[Involvement]] is the fact (ADR-0018).
- **"Event"** is used for both the recurring [[Event series]] and a single dated [[Event occurrence]]. Prefer the precise term in code; in the UI, "Event" means whichever the user is looking at.
- **"Fairness" was a ranking before MS-17 and is a solve after it.** ADR-0016 §5–6 and the original MS-17 described a module that ordered candidates for one Role, and MS-18 was to loop it across dates. It cannot work that way: no [[Involvement]] exists for a date that has not happened, so a ranking is identical for every date in the range. Fairness now staffs a whole occurrence at once and MS-18 is the loop around it (ADR-0020). Anything describing fairness as a score or a sorted list of candidates predates this.
- **[[Permission Level]] is not one straight line.** The tier list reads `viewer → member → editor → elder → admin → super_admin`, which suggests `admin` sees everything `elder` does. It does not, and never has: `firestore.rules` has always defined `isElder()` as `['elder', 'super_admin']` and `isAdmin()` as `['admin', 'super_admin']`, so shepherding data is closed to admins. [[Event visibility]] follows the rules rather than the list — an `elder`-visibility Event is invisible to an admin. **One consequence, surfaced in MS-99:** the week-shift tool now refuses for anyone who cannot see every rung, so it is `elder`/`super_admin` only. Reading the tier list as a hierarchy is the mistake; `admin` is an operational tier, not a pastoral one.
