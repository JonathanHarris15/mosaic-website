# ADR 0029 — A directory photo is self-editable

**Status:** Accepted
**Date:** 2026-08-05
**Amends:** [ADR 0012](0012-membership-track-field-and-tag-projection.md) (the self-editable set). Contrasts with [ADR 0027](0027-a-directory-request-is-how-you-change-your-own-record.md).

## Context

The directory card has had a photo slot since it was built, rendering
`person.photoUrl` with a placeholder behind it. Nothing ever set it.

The immediate question is not "how do we upload a file" but **who is allowed
to**, because the two ADRs on either side of this one point opposite ways.
ADR 0012 says contact details, birthday and sex-while-unset are self-editable.
ADR 0027 says the name is not — it needs an editor to approve a change — and
adds a whole request queue for the household.

A photo could plausibly go either way, and the wrong choice is expensive in both
directions: an approval queue means an editor reviews every headshot forever, and
no approval means whatever a member uploads is what the congregation sees.

## Decision

**A photo is self-editable.** You set your own without asking. An editor sets or
clears anyone's.

### 1. Why it sits with contact details and not with the name

The line ADR 0027 actually drew is not "important" versus "unimportant". It is
**whether anything else in the app reads the field as an identifier**. A name is
read by the Service Builder, the Calendar, the rosters, the @-mention picker and
every elder's note; one person changing it silently changes what those all say.
A household is a shared structure — proposing one asserts something about other
people's records.

A photo is neither. It is a fact about you that only you have, it appears in
exactly one place, and nobody else's record moves when it changes. That is the
same shape as your phone number, which has been self-editable since ADR 0012.

The practical argument points the same way. A congregation-sized queue of
headshots to approve is real, recurring work for whoever holds the editor role,
and the failure it guards against — someone uploading something they should not —
is already possible in the address field, is visible to everyone the moment it
happens, and is one click for an editor to clear.

### 2. The photo is resized in the browser, not stored as taken

A phone photo is 3–8MB and the directory renders it at 56 pixels. Every upload
is drawn through a canvas capped at 800px on its longest edge and re-encoded as
JPEG at 0.85 before it leaves the browser. That also normalises a PNG screenshot
and a 12-megapixel portrait into the same small thing, and it is why the accepted
types are JPEG, PNG and WebP: those are what a canvas can reliably decode. A file
input restricted to them also makes iOS hand over a JPEG rather than the HEIC it
stores.

Small images are never enlarged. Upscaling a thumbnail stores a blurrier, bigger
copy of the same picture.

### 3. Every upload gets its own path

`people_photos/{personId}/{fileId}`, never a fixed path per Person. Overwriting
one path means the new bytes live at a URL the browser already has an answer for,
so a replaced photo keeps showing the old face — which is the one thing replacing
a photo has to do.

### 4. Clients never delete from Storage, a trigger does

Storage rules **cannot read Firestore**. They can see the uploader's uid and
nothing else, so they cannot tell whether this account owns this `personId`. A
rule permissive enough to let someone tidy up their own old photo is permissive
enough to let any signed-in account delete anyone's.

So client deletes are refused outright, and `cleanUpReplacedPhoto` — a trigger on
`people/{personId}` — removes a blob once the Person stops pointing at it. That
covers replacement, removal and the Person being deleted, and it also catches the
browser closed between the upload and the tidy-up, which would otherwise leak the
old file for good. It is best-effort: the photo has already changed by the time it
runs, so failing to remove bytes must never look like failing to change the photo.

### 5. What the Storage rules *can* enforce, they do

Size under 5MB and a content type matching `image/*`. Without that, this path
accepts an executable or a 2GB file from any signed-in account. What stops
someone attaching an upload to a Person they do not control is the **Firestore**
rule on `people`, which now allows `photoUrl` and `photoPath` alongside contact,
birthday and sex — and only on your own linked record.

### 6. The framing is stored, not baked in

A photo is almost never a headshot. It is a group shot, or a wide picture with
the person off to one side, and a circular 56px frame shows whatever happens to
be in the middle. So the Person carries a **crop** beside the image —
`photoCrop: {x, y, zoom}` — where `x`/`y` are the percentages CSS
`object-position` takes and `zoom` multiplies an `object-fit: cover` baseline.

Storing the crop rather than re-encoding the cropped pixels is what makes
reframing possible *later*. Baking it in would mean every adjustment needs the
original file, which by then most people no longer have — they uploaded it from a
phone months ago. This way reframing edits two numbers.

`PersonPhotoCore.frameStyle` is the only place a crop becomes CSS, and the
reframing preview, the profile page and every directory card all call it. That
is what makes the preview honest: the circle someone drags in is the real frame
carrying the real style, so what they let go of is literally what the
congregation sees.

A new upload resets to centred. Carrying the previous crop over would frame the
new picture by where the *old* one happened to need looking at.

## Consequences

- The `people` self-edit allow-list grows by two fields. It is still an
  allow-list: membership, tags and everything shepherding remain untouchable.
- `PersonPhotoCore.canManagePhoto` is the single answer to "may this person
  change this photo", consulted by both the profile page and the directory, so
  the two surfaces cannot drift apart from each other or from the rule.
- Orphaned blobs are possible in one case: an upload that succeeds and whose
  Firestore write then fails leaves bytes nothing points at. Nothing collects
  those. At a headshot every few years it is not worth a sweeper.
- **Photos are not in the mobile bundle yet.** The phone apps ship their own copy
  of `public/`, so this needs a `cap sync` and a store build to reach them.
