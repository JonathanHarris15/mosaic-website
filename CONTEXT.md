# Mosaic Domain Model

## Language

**Elder**:
A church officer with a shepherding role. The canonical term in code (role: `elder`).
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
The rich-text content of a Shepherding Note or Meeting Minutes record. Stored as TipTap JSON. May contain Cross-References.
_Avoid_: Content, text, body (use Note Body as the full compound term)

**Note Module**:
The shared TipTap-based editor component used to author both Shepherding Notes and Meeting Minutes. Provides the @-mention Cross-Reference picker. Mounted in different surrounding UIs depending on context (inline panel on Shepherding Profile; split-pane editor on Meeting Minutes page).
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
An elder-defined label that can be applied to a Person within the Shepherding System. Tags are the primary filter criterion for Filtered Views. Any elder or super admin can create, delete, or apply/remove tags on a Person. Examples: "Red Flag", "New Member Follow-up", "Married".
_Avoid_: Label, category, attribute

**Red Flag**:
A Shepherding Tag (not a built-in field) used as the canonical example of elder-defined tagging. No special UI treatment beyond being a tag.
_Avoid_: Alert, priority, built-in status

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
The Page Template placement within a Service Guide Template designated to expand or contract in count to hit the booklet's target page total. Generalises today's sermon-notes padding behaviour; it keeps at least one page (matching today's "always one sermon-notes page") and the booklet warns rather than dropping content when real pages exceed the target.
_Avoid_: Padding page, blank page, spacer

**Service Guide Manager**:
The editor+ authoring surface (`service-guide-manager.html`) for the Page Library, Style Presets, and Service Guide Templates. Carries the authoring guardrails — live validation, preview-before-save, and "reset to seeded default."
_Avoid_: Template editor (ambiguous), admin page

**Order of Service editor**:
The structured liturgy surface (`service-builder.html`) launched from the Service Calendar. The editor fills it out **first**: preacher/hymn/person pickers and the Service Theme. It is the **first source** — the canonical structured Service that **Builder Components** are informed from. It is also where the week's Service Guide Template is chosen (or the legacy system toggled on) for the booklet that follows; in the new system the chosen template decides which non-static Builder Components (e.g. baptism, congregational prayer) it prompts, while the legacy system keeps the old "Include Baptism?" checkbox.
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
  - `lastPastoralPrayerDate`: The date (YYYY-MM-DD) of the last time this person was prayed for in the pastoral prayer.
  - `baptismDate`: The date (YYYY-MM-DD) this person was baptized, derived from the Service at which they were a Baptism Candidate. Absent if they have not been recorded as baptized.
  - `createdAt`: Timestamp when the record was created.
  - `updatedAt`: Timestamp of the last modification.
- **Sub-collections**:
  - `involvement`: Records of active participation in services (e.g., preaching, leading).
  - `pastoral_prayer_history`: Records of when the person was the subject of the pastoral prayer.

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
A record of a Person's participation in a Service in a specific Role.
- **Fields**:
  - `serviceDate`: The date of the service (YYYY-MM-DD).
  - `type`: The role type (see Roles).
  - `metadata`: Optional extra data (e.g., prayer type, prayer text).

## Roles
Canonical names for types of involvement.
- `service_leader`: The primary facilitator of the service.
- `preacher`: The person delivering the sermon.
- `worship_leader`: The person leading the musical worship. Surfaces in the UI as the "Music Leader."
- `worship_helper`: A person who accompanies the Music Leader (e.g. an accompanist or additional musician). A Service may have several. Surfaces in the UI as a "Music Helper." Distinct from `worship_leader` so helpers are separable in participation history and analytics.
- `sermonette`: The person delivering a shorter message. In the calendar view, this is displayed as a badge and is editable inline by admins.
- `baptism`: A liturgical event marked by `hasBaptism: true`. The people being baptized are the Service's Baptism Candidates. Displayed as a read-only badge in the calendar views.
- `prayer`: The person leading a specific prayer (praise or confession).
- `pastoral_prayer`: The person being prayed for in the weekly pastoral prayer (subject). Note: These are tracked in the `pastoral_prayer_history` collection, not the `involvement` collection.

## Shepherding System

### Elder Document
A standalone text document created and managed by elders, stored in the `elder_documents` collection. Not attached to any Person. Replaces and generalises the former `elder_meetings` concept.
- **Fields**: `title`, `contentJson`, `authorName`, `authorUid`, `createdAt`, `updatedAt`, `updatedByName`, `docType` (optional, defaults to 'note'), `filterId` (for care-list type).
- `docType`: Can be `'note'` (standard TipTap document) or `'care-list'`.

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

## User Interface Conventions

### Service Calendar
- **Baptism Indicator**: 
  - **List View**: A blue status badge with a `water_drop` icon.
  - **Table View**: A dedicated "Baptism" column showing the Baptism Candidates' names.
  - **Editing**: Read-only in the calendar; Baptism Candidates are managed in the Order of Service editor (linked to Person records). In the legacy system the "Include Baptism?" toggle sets `hasBaptism`; in the new system `hasBaptism` is derived from whether the week's Service Guide Template requests the baptism component (ADR-0010).
- **Sermonette Indicator**: 
  - **List View**: A purple status badge with a `mic` icon.
  - **Table View**: Displayed within the "Preacher" column as a secondary entry (e.g., "Jane Doe (Sermonette)").
  - **Editing**: Editable inline by admins, linked to a Person record.
- **Editing Summary**: 
  - Sermonette leaders are linked to People and editable from list/table.
  - Baptism Candidates are linked to People and editable from the Order of Service editor (read-only in the calendar).
