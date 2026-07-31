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
A label that can be applied to a Person. Tags are the primary filter criterion for Filtered Views and the People list. Elders and super admins are the primary managers — any of them can create, delete, Rename, Merge, or apply/remove tags on a Person — but tags are not elder-only-*visible*: some tags (e.g. the Member tag, and any Membership Tag) are surfaced to ordinary members in the People directory. Visibility is governed per-tag (see `hidePeople` metadata), not by the tag concept itself. A tag has a stable identity that is independent of its name: renaming a tag changes only its display name, never which Persons carry it. Examples: "Red Flag", "New Member Follow-up", "Married". Membership Tags are a special, code-defined subset — see Membership Tag.
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
_Avoid_: Member tag (the legacy single "Member" tag this subsumes — the Member tag is now one of the code-defined Membership Tags), status tag

**Elder Tag**:
The Projected Tag that marks a Person as an Elder. Projected from the Person's Linked User having Permission Level `elder` — it is **not** hand-applied: linking/unlinking a User, or a Permission Level change to/from `elder`, adds or removes it. Like all Projected Tags it is immutable (no rename/delete/merge/hide). It is the canonical answer to "which Persons are Elders," and therefore supplies the assignable-elder set for Elder Assignment. Every Elder is also a Member, so an elder Person carries both the Elder Tag and their Membership Tags. Distinct from the `elder` Permission Level, which is the permission source the tag is projected from (the Permission Level grants shepherding *access*; the tag makes elder-ness a filterable, graph-visible Person attribute). Its visibility in the member-facing Membership Directory is **fixed and visible to ordinary members** (not toggleable, like all Projected Tags) — eldership is a public office.
_Avoid_: Elder role (that is the `elder` Permission Level), shepherd tag

**Membership Directory**:
The People directory as seen by the whole congregation, split into two tabs. The **Members tab** shows every Person carrying the Member tag (stage ∈ {Member, Moving Membership}). The **Non-members tab** shows the remaining active People who lack the Member tag (Visitor, Regular Attender, Prospective Member, Previous Member). Contact information is visible to members on both tabs (a member can look up a recent visitor). **Inactive** People appear on neither tab for a plain member. On either tab, an editor can enter **Edit Mode** to manage People inline. Supersedes the former single filter that showed non-editors only the ad-hoc "Member"-tagged people.
_Avoid_: People directory (ambiguous with the editor-facing People Manager), member list

**Edit Mode**:
A toggle available to editors (and above) on the Membership Directory that turns the read-only directory into an inline People manager — the same surface, switched from viewing to editing People attributes (contact info, Membership Track slider, tags). Off by default; a plain member never sees the toggle.
_Avoid_: Manage mode, admin mode

**Linked User**:
The association between a User (an authenticated account with a Permission Level) and a Person record, stored bidirectionally (`users.personId` ↔ `people.userId`) and set by an admin. When a User is linked, their own `profile.html` surfaces the **self-editable** fields of their Person and writes straight to the Person record (one source of truth, no copy). Self-editable fields are the Person's contact info (email, phone, address) and birthday, plus `sex` **only while unset** (a person may set their sex once; changing an already-set value is editor-only). The Membership Track, Shepherding Tags, Shepherding Status, involvement, and all shepherding data are **never** self-editable. From the Membership Directory, a Person viewing their own detail card gets an "Edit my info →" link to `profile.html` rather than inline editing. Anniversary is deliberately *not* self-editable — it belongs to Family structures (added later).
_Avoid_: Account link, member login (a User is not necessarily a member)

**Family**:
A first-class entity (its own `families` collection) that groups a household for the Membership Directory: `{ husbandId?, wifeId?, childIds[], anniversary? }`. **Husband is exactly one male Person, Wife is exactly one female Person** (matching the `sex` enum); every field is optional, so partial families are allowed (a widow + kids, a childless couple, etc.). **Anniversary** (the couple's wedding date) lives on the Family, not the Person. Children are the shared `childIds` list — not duplicated onto each parent. **Multiple generations are emergent, not a nested tree:** a Person is a spouse in at most one Family (their marriage) and a child in at most one Family (their family of origin); a child who marries starts their own Family, and walking child → their-Family-as-spouse → that Family's children traverses the tree across any number of generations. **Editor-authored, not elder-only:** a Family is built and edited by an editor (or above) in the Membership Directory from *either spouse's card* — declaring who the spouse is and who the children are — never from the elder-only Shepherding Profile. On the Shepherding Profile it only **projects read-only** into the Relationships panel, as gendered Projected Relationships (Husband/Wife, Father/Mother, Son/Daughter, Brother/Sister; neutral fallback when sex is unset) covering spouse, parents, children, and siblings (siblings = the other children of the family of origin). Distinct from a Custom Relationship (the freeform, elder-authored edge model).
_Avoid_: Household (use only as prose), family tree (that is the emergent traversal, not a stored structure), relationship (that is the freeform shepherd concept)

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
An elder-only visual tool on the Shepherd Dashboard for exploring how People are connected. People are nodes; their relationships are edges, rendered in an **interactive force-directed graph** — an Obsidian-style physics simulation where nodes are draggable and their connected neighbours follow. There is **one layout** (the physics web); the different "views" are just **edge-type filtering**. A left-hand **Edge-Type Toggle List** switches individual edge types on/off — one entry per Relationship Type (the elder-defined vocabulary, growing automatically) plus **Family** and **Elder Assignment**. Three **preset buttons** — **Full Web** (all edge types on), **By Family** (only Family on), **By Elder** (only Elder Assignment on) — set the toggles to common configurations; the elder can also set any combination by hand. A separate **Show-Isolated toggle** controls whether People with no *currently-visible* edges are hidden or shown. Clusters (households, Care Groups) are **emergent** from the filtered edges under the physics sim, not a separate layout mode. Visual/layout/styling design is authored separately (Cloud Design); this entry fixes only the data-and-behavior contract.
_Avoid_: Relations Dashboard, relationship graph (use only as prose), view mode (there is one layout, filtered by edge type)

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
_Avoid_: Role template, role config

**Event**:
A dated occurrence that carries **Roles** to be filled. A Sunday **Service** is one **locked, recurring** Event — always present, its liturgical Roles undeletable. Arbitrary Events (introduced with the Calendar, MS-99) can carry Servant Roles too. Fairness is scoped **per Event series**: a Person's serving history for a Role is counted within that recurring Event, not globally, so someone can be overdue for one Event's Role and fresh for another's at the same time.
_Avoid_: Meeting, appointment (use Event); do not conflate with Service (a Service is one kind of Event)

**Roles tab**:
The surface that puts named People into a single Event's Roles — every Role that date carries, its slots, each Assignment's state, and the picker that shows who was passed over and why. **One surface, two homes**: it is the Roles section of the Event detail screen, and it is a tab on the service page beside the Order of Service, because the Sunday is staffed every week and its order of service is edited elsewhere. Both mount the same markup and the same behaviour, so they cannot drift.

**It fills Roles; it does not decide which exist.** Which Roles an Event carries belongs to the **Event series** and is set there — deciding it from inside one date would change every date. So on the service page the tab has no way to add or remove a Role, only a way through to where that is decided. **Liturgical Roles are absent from it**: they are fields on the Service that the printed guide reads, set in the Order of Service (ADR-0018 §2).
_Avoid_: Roster tab, assignment tab, staffing screen

**Roles Manager**:
The editor+ dashboard card where **Role Definitions** are authored and managed, and where a date range of a recurring **Event** is **auto-assigned** — the system drafts a fair, rule-valid lineup for the user to review and accept (propose-then-approve). Distinct from the **Roles tab**, which assigns a single date by hand.
- **One Roles Manager, opened on both.** The phone does not get a port of this screen; it opens the same page inside the shell (`?shell=mobile`), reachable from the phone's home grid, which is the phone's dashboard. This screen is where a Role's slots and restriction rules are decided, so a second copy of it would be a second place for those rules to drift from the model.
- **On a phone it is a list, then an editor** — never both, because there is only room for one. The list's rows become cards you tap; delete moves into the editor's own bar, and the only back arrow is the shell's, which the page answers: out of the Role you have open, or out of the page if you have none.
_Avoid_: Scheduler page, role admin

**Permission Level**:
An authenticated User's access tier — the concept formerly called the User **role** (viewer → member → editor → elder → admin → super_admin). Renamed to free the word "role" for serving **Roles**; the tier values are unchanged. The stored field is `users.permissionLevel`; the legacy `role` field is retained as a fallback (read by the Firestore rules and by client reads) until the migration completes and MS-127 drops it. Distinct from **Membership Stage** (church relationship) and **Role** (serving).
_Avoid_: User role, access role (use Permission Level)

**Inactive** (a Person):
An off-Track state, toggled beside the Membership Stage slider. Marking a Person Inactive **removes their spot on the Membership Track** (they carry no Membership Stage while Inactive) and applies the Inactive Membership Tag in place of a stage tag. The Person's record stays **fully visible** — Inactive is *not* archival and does not hide the record; it is reserved for later use such as surfacing stale records that may warrant deletion. Distinct from **Previous Member**, which is a genuine Track stage (someone who was a Member and has since left but is still a tracked relationship). The prior Membership Stage is retained under the hood so that clearing Inactive restores the Person to where they were on the Track. Replaces the old `membership.status: 'inactive'` value; the existing "active people" filters (`status !== 'inactive'`) become "not Inactive."
_Avoid_: Archived, hidden, deleted, dormant

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
The length of a Tag Hold, expressed as a human-readable span (e.g. "3 months", "12 days"). The basis of the Hold-Duration filter, which narrows a Filtered View or the People list to Persons who have held a tag long enough. Each selected filter tag carries its own minimum, set by a slider on the tag chip — a dot on the chip's lower edge that slides from 0 (anyone carrying the tag) up to a year.
_Avoid_: Tenure, elapsed time

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
Code-defined in `RolesCore.LITURGICAL_ROLES`, undeletable and uneditable, and still wired into the Service entity and the Service Guide. They have **no** editable definition and are **not** stored in `/roles` — storing copies would create a second source of truth and, since `/roles` is editor-writable, would make "locked" Roles editable.
- `service_leader`: The primary facilitator of the service.
- `preacher`: The person delivering the sermon.
- `worship_leader`: The person leading the musical worship. Surfaces in the UI as the "Music Leader."
- `worship_helper`: A person who accompanies the Music Leader (e.g. an accompanist or additional musician). A Service may have several. Surfaces in the UI as a "Music Helper." Distinct from `worship_leader` so helpers are separable in participation history and analytics.
- `sermonette`: The person delivering a shorter message. In the calendar view, this is displayed as a badge and is editable inline by admins.
- `prayer`: The person leading a specific prayer (praise or confession).

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
    - A relationship rule may only name a [[Shared Relationship Type]]; one naming an unshared Type is refused rather than left to evaluate to "nobody qualifies".
  - **A Relationship Group's leader counts as being in the group** for every serving rule. The leader is deliberately *not* inside `memberIds` (ADR-0014 §5), so the plain reading of the roster is wrong here — `RolesCore.inGroup` is the check to use.
- Eligibility (`RolesCore.candidatesFor`) returns every candidate with a **reason** when ineligible, never a silent omission — the Roles tab and auto-assign both have to explain who they passed over. An **Inactive** Person is never proposed; their Involvement history is untouched.

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
- **Roles come from two levels.** The [[Event series]]' `roleSlugs` apply to *every* date of it, minus the liturgical ones; `occurrenceRoleSlugs` are added to *this date alone*. Both draw as fillable cards with the full Assignment state machine, and neither can be added or removed from one date — `occurrenceRoleSlugs` is now legacy, read but no longer written.
- **`occurrenceRoleSlugs`** — which **managed** Roles *this date* needs, chosen on the Event detail screen. Deliberately **not** named `roleSlugs`: that is the [[Event series]]' field, saying which Roles the series carries. Two lists, two levels, two names — sharing one would read as a single field to anyone holding the series entry in their head. `oneOffRoles` sits beside it as `{ id, label }`, since a [[One-off Role]] exists only here.
- **The roster is a subcollection, not a field.** Firestore cannot hide a field from someone allowed to read the document, so "participants can't see who else is coming" only works if each [[Assignment]] is its own document under the occurrence. The occurrence itself carries only `participantIds` and the declined flag — both **derived** from the roster on every write, never maintained by hand.
- **`colour`** — which of eight palette colours it draws in on the Calendar. Kept on the [[Event series]] for a recurring Event, so one change moves every date; on the occurrence itself for a one-off, whose occurrence *is* the whole Event. Never copied down: unlike [[Event visibility]] (which a security rule reads off the document and so must be stamped), a colour is only ever read where the series is already in hand. Decoration only — **the red that means "needs sorting" is not in the palette and always overrides it**, so a chosen colour can never shout or stop something else shouting.
- **A Sunday occurrence is `services/{date}`**, which keeps its liturgical roles as the hardwired fields the Service Guide prints. Assignments sit *alongside* those fields and never over them. A Sunday's chip on the Calendar opens its **Event page** like any other date, where its **Servant** Roles are filled; the liturgy is one prominent click further on. **A liturgical Role is never drawn as a fillable card on an Event page** — that, not the routing, is what keeps the printed booklet safe.
- **One instance can be MOVED to another date without touching the recurrence rule** — "first Sunday of the month, except in August when it is the fifteenth". It is the same instance on a different day and **it carries its roster**, not a cancellation plus a new Event. Two documents result: the new date carries `movedFrom`, and the original carries `movedTo` — the original cannot simply be deleted, because the rule still produces that date and an absent document would draw the Event straight back. Refused onto a date the pattern already produces, onto a date that already has an instance, and for the Sunday Service (whose order of service lives under its own date).
- **A date that is not happening** — skipped (`cancelled`) or moved away (`movedTo`) — draws struck through and quiet on the Calendar, never in the error red, because a gathering that is not taking place has nothing to chase.
- **A one-off Event's details are edited on its occurrence**, because it has no series for them to live on — including its **date**, which is simply a field: a one-off's id is an auto-id, not the date. (One date *of a series* is [[Event series management]]'s move, which must rewrite the id.)
- **An untouched date has no document, and still opens.** The id carries the series and the date, so opening one rebuilds it rather than reporting it missing — but only if the series' rule actually produces that date.
- **Two readings of the same date, not one screen with things greyed out.** An **editor** gets the Role cards: numbered places, empty rows, and each person's state to set. A **member** the roster was shared with gets the roster flat — who is serving, at what — because they are answering "who else is coming", not administering. A member used to get both at once, which named the same people twice on one screen and offered controls they could never use.

### Event series management
Managing an [[Event series]] itself rather than one date of it — **everything true of every date**: its name, start time, place, description, recurrence pattern, [[Event visibility]], colour, and which Roles it carries every time. Reached at `calendar-event.html?series=<id>`, and the only way into the **Sunday Service as an Event**. Distinct from the order of service, which is still built one Sunday at a time: a Sunday chip on the Calendar goes there, never here.
- **Liturgical Roles are shown and locked.** An editor needs to see the whole shape of a Sunday, but those Roles are filled per-Sunday through the Service entity and print in the booklet, so this screen can never drop one (`lockedRoleSlugs`, MS-13).
- **The time lives on the recurrence rule**, not beside it — one home for one fact — and a date carrying its own time still wins. Setting a Sunday time therefore ends the Sunday Service's reliance on its *implied* rule — so the rule written has to keep saying "every Sunday".
- Opening the Sunday Service **reconciles** it: created if it never existed, repaired if it drifted, untouched if it is already right.

### Assignment
A Person placed in one slot of one Role on an [[Event occurrence]] — **the plan, not the record**. Mutable, and never itself a serve record.
- A slot holds **one current** Assignment. Assigning a replacement overwrites it.
- **States** — every Assignment is in exactly one:
  - **Pending**: assigned, not yet heard from. The default.
  - **Confirmed**: they said yes.
  - **Declined**: they said no, and the slot is **flagged for reassignment** — visibly needing attention, not silently empty.
- Carries **who set the state and when**, so the state machine survives being handed to the congregation in MS-20.
- Only **Servant Roles** and [[One-off Role]]s get Assignments. Liturgical Roles keep their existing wiring into the Service entity (ADR-0018 §2).
- **Being *offered* is a different question from being *eligible*.** An ineligible Person is shown, blocked, with a reason — seeing who was passed over is the point of the picker. Somebody **Inactive**, or hidden by a tag carrying `hidePeople` (or `shepherdingHidden`), is not offered *at all*: they are not a candidate who lost. For a hidden Person a blocked row would print the very name the tag exists to hide. Elders and super admins still see them, since that is who the tag hides people from everyone else *for*.
- **On a Sunday, holding a liturgical Role blocks you from a Servant Role on the same date.** You cannot preach and run the sound desk at once. Because the liturgy is stored as *fields on the Service*, not as Assignments, the picker reads that document to find out — and shows those people blocked, naming the liturgical Role, rather than hiding them.
- **Once the date passes**: Confirmed becomes an [[Involvement]] automatically; Declined never does; Pending becomes an open question an editor resolves ("did they serve?"), and an unresolved question never counts as serving.

### One-off Role
A Role created for a single Event and living only on it — "someone to unlock the hall". Deliberately cheap: a **label and some people**, with no definition, no reuse, no slots, no restrictions and no eligibility checking. Forcing every ad-hoc job through the Roles Manager would make the Roles Manager a junk drawer.
- Its [[Involvement]] is written under **one reserved slug**, `one_off`, with the label in `metadata` — never an invented slug per job, which `RolesCore.roleBySlug` could not resolve to a name on any surface showing serve history.
- **Counts as serving** (the person who unlocks the hall every week is not someone who never helps), but is **never a Role to balance** — fairness skips the `one_off` bucket rather than trying to rotate a job that happens once.

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

### Services
The week-by-week view of Sunday **Services** — the Sunday Service series and nothing else. **Renamed from "Service Calendar"** (MS-99): unchanged in function, renamed so it is not confused with the [[Calendar]], which is a different view.
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

### Calendar
The view over **every** [[Event occurrence]] the signed-in person is allowed to see, not just Sundays (MS-99). Editors and above create Events here; what each person sees is governed by [[Event visibility]].
- Distinct from [[Services]], which shows Sundays only and remains the surface for editing a Service's liturgy.
- Loads with **two queries merged client-side** — one filtered by the viewer's rank, one `array-contains` their Person id for `participant`-visible Events. Firestore cannot express that as a single filter, and an unconstrained query **errors outright rather than returning fewer rows** — a failure that looks exactly like "this church has no events". The same trap is documented in `firestore.rules` for the relationship collections.
- **Signed out is not an empty month, and the two look identical unless the page says so.** A signed-out Calendar still draws, because the Sunday Service is fetched **by id** regardless of who is asking while every other Event is filtered by the rungs the viewer's rank may see. So a lapsed session renders as a church that holds a service on Sunday and does nothing else all week. Both Calendar pages say when nobody is signed in and offer the way back; the phone app asks for a sign-in on launch rather than opening on a stranger's home screen (**"continue as guest" is remembered**, or the redirect would undo it).
- **On a phone it is a different screen, not a narrower one.** Seven columns across 390px gives about 50px a day, which fits a number and nothing else — so inside the mobile shell the desktop grid, toolbar and rail panel stand down and the phone draws its own: *Upcoming* in navy at the top, then the **month strip**, then the day or the month underneath it. Swapped on the shell rather than on a media query, because the same 390px window on a desktop still has a mouse and gets the desktop screen.
- **The personal card is *Upcoming*, and it is anchored to today, not to the grid.** It was *You in July* — the browsed month — which answered a question nobody asked: a serve already done sat in it as though it were still to do, and paging the grid back to April changed what you were down for. Now it runs from today over a window you pick (**next week / next 2 weeks / next month**, two weeks by default), which crosses the end of the month more often than not — so it takes its own read rather than sharing the grid's, and ignores **Only mine** and the **Show** ticks. Those govern the grid; a serve of your own is not something a display filter over a different stretch of time should be able to hide from you. What went wrong in the past still belongs to **Needs sorting**, which only speaks once the date has passed.
- **A place still to fill is not the same alarm as somebody saying no.** An editor sees, on the grid and in the list, how many **places to fill** each date ahead still has — a place being open when nobody is in it *or* when the person in it declined. One rule covers both, so the warning comes back by itself when somebody pulls out, with nothing having to remember it was ever cleared. It is said **on the chip and nowhere else** — a `--warning-container` background and a small `warning` glyph — because the chip is what you click to fix it, and the corner of a day cell already says the one thing a *day* can say. Amber, never the error red: **red is spoken for**, every future date has open places at some point, and in red the colour that means "somebody said no" would stop meaning anything. The amber is the same one an Event can be painted, which is not the clash it looks like: **a chosen colour only ever draws the bar down the side of a chip, and a tint only ever fills the background** — so a tinted chip always means the app is saying something rather than an editor having picked a shade. The "you" dot reads off `mine` rather than off the chip's kind, or an amber chip would swallow it. Editors only — a member cannot fill a place, and a count they can do nothing about is weather.
- **The count cannot be stamped on a date.** It depends on the Roles the [[Event series]] carries *today* and on each Role's slots, so a stored flag would go stale the moment a Role was added to the series — and the dates with the most to fill are precisely the [sparse](#event-occurrence) ones that have no document at all. So `loadCalendar` stamps `seriesRoleSlugs` at read time (stripped on the way back out, exactly as `seriesColour` is), and an editor's read brings back the rosters of the dates from today on that **already have somebody on them**. A date nobody is on needs no read: every place on it is open by definition.

#### Month strip
The phone's month: seven columns of day numbers, each carrying up to **three dots** — one per Event on that day, in the Event's own `colour`, with the needs-sorting red overriding it exactly as a chip's bar does. A glance, not a list: the count lives in the cards underneath. Tapping a day shows that day; tapping into a neighbouring month's corner goes to that month, because those dates are not loaded and drawing "nothing on this day" for one of them would be a lie rather than an empty day.

## Flagged ambiguities

- **"Calendar"** meant the Sunday-only Service Calendar before MS-99. It now means the all-Events [[Calendar]]; the Sunday view is [[Services]]. Code, labels and docs saying "Service Calendar" refer to Services.
- **"Assignment" vs "Involvement"** were the same act before MS-99 — assigning someone wrote a serve record immediately, even for a future date. They are now distinct: [[Assignment]] is the plan, [[Involvement]] is the fact (ADR-0018).
- **"Event"** is used for both the recurring [[Event series]] and a single dated [[Event occurrence]]. Prefer the precise term in code; in the UI, "Event" means whichever the user is looking at.
- **[[Permission Level]] is not one straight line.** The tier list reads `viewer → member → editor → elder → admin → super_admin`, which suggests `admin` sees everything `elder` does. It does not, and never has: `firestore.rules` has always defined `isElder()` as `['elder', 'super_admin']` and `isAdmin()` as `['admin', 'super_admin']`, so shepherding data is closed to admins. [[Event visibility]] follows the rules rather than the list — an `elder`-visibility Event is invisible to an admin. **One consequence, surfaced in MS-99:** the week-shift tool now refuses for anyone who cannot see every rung, so it is `elder`/`super_admin` only. Reading the tier list as a hierarchy is the mistake; `admin` is an operational tier, not a pastoral one.
