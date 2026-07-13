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
A label that can be applied to a Person. Tags are the primary filter criterion for Filtered Views and the People list. Elders and super admins are the primary managers — any of them can create, delete, Rename, Merge, or apply/remove tags on a Person — but tags are not elder-only-*visible*: some tags (e.g. the Member tag, and any Membership Tag) are surfaced to ordinary members in the People directory. Visibility is governed per-tag (see `hidePeople` metadata), not by the tag concept itself. A tag has a stable identity that is independent of its name: renaming a tag changes only its display name, never which Persons carry it. Examples: "Red Flag", "New Member Follow-up", "Married". Membership Tags are a special, code-defined subset — see Membership Tag.
_Avoid_: Label, category, attribute (and "elder-only tag" — visibility is per-tag)

**Membership Track**:
The single ordered progression a Person moves along in their relationship with the church: **Visitor → Regular Attender → Prospective Member → Member → Moving Membership → Previous Member**. A Person sits at exactly one Membership Stage at a time. The Track is the church-relationship state machine — the one canonical replacement for the previously conflicting `membership.status` field, the ad-hoc "Member" tag, and any use of user *role* to imply membership. It is deliberately **not** a permission or a User role. A Person's stage on the Track is *not* self-editable — only an editor (via the stage slider) can move someone along it.
_Avoid_: Membership status (as an enum synonym), member type, member level

**Membership Stage**:
One of the six code-defined positions on the Membership Track. The stages are baked into the code — their set, order, and names cannot be changed by any user. Moving a Person to a new stage is the only Track mutation.
_Avoid_: Membership state, status value

**Projected Tag**:
A Shepherding Tag that is **code-defined and projected from a source-of-truth field**, not hand-applied — its presence on a Person is written by the projection and never edited directly. Immutable: it **cannot be renamed, deleted, merged, or visibility-toggled** by anyone, because the code seeds and maintains it. Two families exist: **Membership Tags** (projected from a Person's Membership Stage) and the **Elder Tag** (projected from the `elder` role of a Person's Linked User). The generalisation of the previously membership-only "special code-defined immutable tag" idea.
_Avoid_: System tag, locked tag, derived tag (use Projected Tag)

**Membership Tag**:
A Projected Tag that *projects* a Person's Membership Stage onto them so the stage is filterable and searchable through the ordinary tag filter system (the reason the Track is represented as tags at all). Each Membership Stage maps to a **defined set** of Membership Tags — usually a single eponymous tag (Visitor→Visitor, Regular Attender→Regular Attender, Prospective Member→Prospective Member, Member→Member, Previous Member→Previous Member), but **Moving Membership projects two tags: its own Moving Membership tag *and* the Member tag**. This overlap is deliberate: it lets "the Members directory = every Person carrying the Member tag" stay a single trivial query while still distinguishing those mid-transfer. Advancing along the Track re-derives the whole set (removing tags the new stage doesn't project, adding the ones it does). Inactive projects the Inactive tag instead of any stage tag. Membership Tags are the membership family of Projected Tags. The Membership Stage field on the Person is the source of truth; the Membership Tags are its synced projection (written together, never edited independently).
_Avoid_: Member tag (the legacy single "Member" tag this subsumes — the Member tag is now one of the code-defined Membership Tags), status tag

**Elder Tag**:
The Projected Tag that marks a Person as an Elder. Projected from the Person's Linked User having role `elder` — it is **not** hand-applied: linking/unlinking a User, or a role change to/from `elder`, adds or removes it. Like all Projected Tags it is immutable (no rename/delete/merge/hide). It is the canonical answer to "which Persons are Elders," and therefore supplies the assignable-elder set for Elder Assignment. Every Elder is also a Member, so an elder Person carries both the Elder Tag and their Membership Tags. Distinct from the User role `elder`, which is the permission source the tag is projected from (role grants shepherding *access*; the tag makes elder-ness a filterable, graph-visible Person attribute). Its visibility in the member-facing Membership Directory is **fixed and visible to ordinary members** (not toggleable, like all Projected Tags) — eldership is a public office.
_Avoid_: Elder role (that is the User role), shepherd tag

**Membership Directory**:
The People directory as seen by the whole congregation, split into two tabs. The **Members tab** shows every Person carrying the Member tag (stage ∈ {Member, Moving Membership}). The **Non-members tab** shows the remaining active People who lack the Member tag (Visitor, Regular Attender, Prospective Member, Previous Member). Contact information is visible to members on both tabs (a member can look up a recent visitor). **Inactive** People appear on neither tab for a plain member. On either tab, an editor can enter **Edit Mode** to manage People inline. Supersedes the former single filter that showed non-editors only the ad-hoc "Member"-tagged people.
_Avoid_: People directory (ambiguous with the editor-facing People Manager), member list

**Edit Mode**:
A toggle available to editors (and above) on the Membership Directory that turns the read-only directory into an inline People manager — the same surface, switched from viewing to editing People attributes (contact info, Membership Track slider, tags). Off by default; a plain member never sees the toggle.
_Avoid_: Manage mode, admin mode

**Linked User**:
The association between a User (an authenticated account with a role) and a Person record, stored bidirectionally (`users.personId` ↔ `people.userId`) and set by an admin. When a User is linked, their own `profile.html` surfaces the **self-editable** fields of their Person and writes straight to the Person record (one source of truth, no copy). Self-editable fields are the Person's contact info (email, phone, address) and birthday, plus `sex` **only while unset** (a person may set their sex once; changing an already-set value is editor-only). The Membership Track, Shepherding Tags, Shepherding Status, involvement, and all shepherding data are **never** self-editable. From the Membership Directory, a Person viewing their own detail card gets an "Edit my info →" link to `profile.html` rather than inline editing. Anniversary is deliberately *not* self-editable — it belongs to Family structures (added later).
_Avoid_: Account link, member login (a User is not necessarily a member)

**Family**:
A first-class entity (its own `families` collection) that groups a household for the Membership Directory: `{ husbandId?, wifeId?, childIds[], anniversary? }`. **Husband is exactly one male Person, Wife is exactly one female Person** (matching the `sex` enum); every field is optional, so partial families are allowed (a widow + kids, a childless couple, etc.). **Anniversary** (the couple's wedding date) lives on the Family, not the Person. Children are the shared `childIds` list — not duplicated onto each parent. **Multiple generations are emergent, not a nested tree:** a Person is a spouse in at most one Family (their marriage) and a child in at most one Family (their family of origin); a child who marries starts their own Family, and walking child → their-Family-as-spouse → that Family's children traverses the tree across any number of generations. **Editor-authored, not elder-only:** a Family is built and edited by an editor (or above) in the Membership Directory from *either spouse's card* — declaring who the spouse is and who the children are — never from the elder-only Shepherding Profile. On the Shepherding Profile it only **projects read-only** into the Relationships panel, as gendered Projected Relationships (Husband/Wife, Father/Mother, Son/Daughter, Brother/Sister; neutral fallback when sex is unset) covering spouse, parents, children, and siblings (siblings = the other children of the family of origin). Distinct from a Custom Relationship (the freeform, elder-authored edge model).
_Avoid_: Household (use only as prose), family tree (that is the emergent traversal, not a stored structure), relationship (that is the freeform shepherd concept)

**Relationship**:
A connection among Persons, surfaced on the Shepherding Profile's Relationships panel (never in the member-facing Membership Directory). Two kinds share the panel: a **Custom Relationship** (elder-authored, stored, deletable — a **Pairwise Relationship** or a **Relationship Group**) and a **Projected Relationship** (derived from Family). Elder Assignment is deliberately **not** shown in this panel — it is a relationship in the Relations Viewer graph only. Relationships can cross-cut households.
_Avoid_: Family (that is the tidy directory entity), tag (that is a Person label, not a Person-to-Person edge)

**Custom Relationship**:
An elder-authored, stored, deletable Relationship carrying a Relationship Type — the freeform, hand-built layer (vs. a Projected Relationship, which is derived from Family). Two shapes: a **Pairwise Relationship** — a typed edge between two Persons — and a **Relationship Group** — a named roster of a Group-kind type. Authored in the **Relationships tab** of Manage Tags and Relationships (where types are also defined), or quick-added from a Shepherding Profile into an **already-defined** type. Only Custom Relationships are deletable; Projected Relationships are not.
_Avoid_: Manual relationship, freeform edge (use Custom Relationship)

**Pairwise Relationship**:
A Custom Relationship that is a single typed edge between two Persons, stored in the `relationships` collection as `{fromId, toId, typeId}`. If its Relationship Type is **Prioritized**, `fromId` is the **priority holder** (shown with the type's Holder Label) and `toId` the Counterpart; if **Non-Prioritized** it renders symmetrically.
_Avoid_: edge, link, directional relationship (use Pairwise Relationship)

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

**Servant Role**:
A non-liturgical service contribution — kids ministry, setup/teardown, coffee, sound, etc. — as opposed to the liturgical Roles (preacher, service leader, worship leader…). Servant Roles will be scheduled on a future **servant-roles tab** of the Service Calendar, distinct from the Order of Service editor, and recorded as Involvement like liturgical roles. **Out of scope for the People System (MS-81)** — MS-81's only obligation is to keep the Involvement model **role-open** (any `type` slug is accepted, no schema change) so the servant-roles feature can plug in later.
_Avoid_: Ministry role, volunteer role (use Servant Role), duty

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
