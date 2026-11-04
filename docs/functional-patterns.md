# User-facing structures and functional patterns

## Purpose and evidence

This is a first-pass functional description for reimplementing Lists & Prices. It was extracted from application source code, not from existing documentation. The descriptions are in English; there are no database schemas, programming-language declarations, or executable examples.

The emphasis is on what users manipulate, what an operation means, and how views are derived. Source references identify the implementation behind each claim. This is a static code review, not a claim that every interaction has been exercised in a browser. “Current behavior” includes limitations and differences between screens; “reimplementation abstraction” names a useful boundary, not an additional implemented feature.

## 1. The overall functional model

The application is an account-owned workspace containing ordered folders, lists, and item trees. Shopping entries, tasks, headings, and notes share the same item identity model. Several interfaces select and transform that workspace rather than maintain separate copies of the underlying tasks.

The main user-facing structures are:

| Structure | Functional meaning |
| --- | --- |
| Workspace | One user's shared, locally cached collection of content and shared preferences. |
| Folder | An organizational node containing child folders and lists, with local workflow configuration. |
| List | A named collection of items, or a visual divider between collections. |
| Item | An identifiable text-bearing entry, optionally priced, completed, nested, or pinned. |
| Named checkbox | An independently toggleable workflow state configured by the item's immediate folder. |
| Reference | A link to an existing folder, list, or item, independent of its display name. |
| Favourite or pin | A shortcut to existing content, not a duplicate of that content. |
| Report membership | Inclusion of a folder in a named cross-folder projection. |
| Errand | A derived item-and-list pairing with effective location tags. |
| Location and starting point | A possible destination and the origin used to calculate proximity. |
| Nearby checklist entry | Remembered visibility and dismissal of an errand's content version. |
| Commit | A named historical checkpoint that can be inspected without editing it. |
| Portable export | Selected content represented outside its live collaborative history. |

Sources: [core entities and operations](../src/lib/data.ts), [workspace lifecycle](../src/lib/yjsStore.svelte.ts), [errands](../src/lib/nearbyErrands.ts), [report memberships](../src/lib/reportAssignments.ts).

## 2. Identity, containment, and order

### 2.1 Stable identity rather than name identity

Folders, lists, items, sheets, named checkboxes, and commits are created with generated identifiers. Names are editable labels. Renaming a task does not replace its identity, its children, or references to it.

Reports are different: their names are the membership grouping keys, rather than a separate report identifier. Nearby groups are also derived identities: an explicitly tagged item forms its own group, while items inheriting tags share their list's group.

Sources: [creation helpers](../src/lib/data.ts), [reports](../src/lib/reportAssignments.ts), [errand groups](../src/lib/errandGroups.ts).

### 2.2 Containment is a relationship, not an embedded copy

- A folder has one parent folder, or is at the workspace root.
- A normal list belongs to one folder. The home interface does not create or move a list directly into the root.
- An item belongs to one list and can have a parent item within that list's interpreted tree.
- Reports, favourites, pins, and errands refer back to these same entities.
- A list reads named-checkbox configuration from its immediate folder, not from every ancestor folder.

**Reimplementation abstraction:** maintain an identity-based content graph, then build navigable trees and shortcut collections from it.

Sources: [entity relationships](../src/lib/data.ts), [home navigation](../src/lib/components/HomeScreen.svelte), [list workflow lookup](../src/lib/components/ListScreen.svelte).

### 2.3 Multiple orders coexist

Folders and lists in the same container participate in a mixed numeric order. Items are ordered among siblings with the same parent. New content can be inserted at the top or bottom; child items added through the UI append. Reordering updates position values without recreating entities. Order-only changes generally do not update the modification timestamp.

Favourite order is independent of folder/list order. A pinned item is shown in a separate shortcut bar; pinning does not move its underlying row. Journal export uses chronological order, but journal display retains normal item-tree order.

Item sibling comparison breaks equal positions by identifier. Do not assume every folder, list, report, and shortcut comparison uses that same tie-breaker: several compare only numeric order, and favourites additionally prefer folders over lists on a cross-kind tie.

**Current behavior:** folder metadata still contains a folders-first preference, but the current home row projection mixes folders and lists by order. The global list traversal also uses mixed order despite a comment referring to the preference. Treat the stored setting separately from the active rendering behavior.

Sources: [ordering helpers and list traversal](../src/lib/data.ts), [item comparison](../src/lib/hierarchy.ts), [home row projection](../src/lib/components/HomeScreen.svelte), [favourites and journal export](../src/lib/components/ListScreen.svelte).

## 3. Organizational entities

### 3.1 Folder

A folder has identity, name, color, parent, position, creation and modification times, and independent completion, favourite, and archive flags. Additional configuration includes checkbox definitions, completion filtering, local list navigation, and the stored folders-first preference.

Folder completion is a manual organizational marker. It is not calculated from its children and does not complete those children. Folder archival, in contrast, makes descendant folders and lists effectively archived without changing each descendant's own archive flag.

Renaming can also change color. The optional “color children” action updates immediate child folders and lists; it is not a recursive recoloring of the entire subtree. Items do not have their own color field. Moving a list into another folder copies the destination folder's color to that list; moving a folder does not automatically recolor its subtree.

Deleting a folder deletes descendant folders and contained lists/items, and removes its report memberships. This deletion helper does not also traverse the remaining spreadsheet metadata, so do not describe it as deletion of every possible legacy content type.

Sources: [folder readers, update, deletion, and archive predicates](../src/lib/data.ts), [folder actions](../src/lib/components/HomeScreen.svelte).

### 3.2 List and divider

A list has identity, name, owning folder, color, position, timestamps, independent completion/favourite/archive flags, and its own item completion filter. It can remember whether newly added root items should default to notes and whether dates should be displayed.

- A plain list presents tasks, notes, and headings without price controls.
- A priced list exposes price and quantity for ordinary tasks, plus a total.
- A divider is represented by list metadata but acts as a separator in the folder screen. Its ordinary row cannot be opened and offers deletion/reordering rather than normal list actions. This is a UI convention, not a data-layer prohibition on attaching items to its identifier.

Lists can switch between plain and priced presentation without discarding their items or stored price/quantity values. List completion is a manual flag, not “all items are checked.” Completing a list leaves individual task states unchanged.

Date-based list creation supplies a display name when no name is entered. A future-date choice affects insertion relative to a divider, when one exists. There is no persistent scheduling date or persistent future-list flag. This is a naming-and-ordering convention, not a calendar engine.

Sources: [list metadata and creation](../src/lib/data.ts), [list creation and divider rows](../src/lib/components/HomeScreen.svelte), [type conversion and list completion](../src/lib/components/ListScreen.svelte).

### 3.3 Item roles

An item has identity, list membership, text, sibling position, optional parent, timestamps, optional price and quantity, legacy completion state, named-checkbox states, and heading/note/pin/full-screen flags.

The visible roles are interpretations of those flags:

| Role | User-facing behavior |
| --- | --- |
| Task | Has completion controls; may have price and quantity in a priced list. |
| Heading | A section label without ordinary task completion or price controls. |
| Note | Text without ordinary task completion or price controls; can open in a full-screen editor. |
| Subtask or subnote | A task or note whose parent is another item; displayed with indentation. |

The renderer gives heading presentation precedence over note presentation. Do not invent a strict mutually exclusive type system that the stored flags do not enforce.

Tasks and notes can both contain children through the UI while below the child-creation depth limit. Headings are not accepted as new reparent destinations. Converting a root task to a heading clears legacy and configured checkbox completion, price, and quantity, but retains existing descendants. Removing heading status does not restore the cleared values.

Sources: [item readers and mutations](../src/lib/data.ts), [row rendering, child actions, and heading conversion](../src/lib/components/ListScreen.svelte).

## 4. Trees and safe structural operations

### 4.1 Read a recoverable tree

An item's tree is displayed parent-first, followed by each parent's ordered descendants. The tree projection includes depth and sibling position for rendering and operations.

Missing parents are interpreted as root placement. A cycle is interpreted consistently by cutting the parent link of the cycle member with the smallest identifier. These read-time repairs do not immediately rewrite shared data: a missing parent may simply not have arrived from synchronization yet. An explicit move can materialize a recovered cycle break, but not a temporary orphan interpretation.

Existing deeper trees and children of headings remain renderable. Three levels is a restriction on new UI child creation and validated reparenting, not a universal guarantee about all imported or previously stored trees.

Sources: [tree projection and cycle resolution](../src/lib/hierarchy.ts), [readers and cycle materialization](../src/lib/data.ts).

### 4.2 Move a subtree, not each selected descendant independently

When both a parent and its child are selected, moving the selection operates on the selected roots. Their descendants stay attached. A validated reparent rejects missing selections, missing destinations, heading destinations, moves into a selected subtree, and resulting moved-subtree depths beyond three levels.

Item dragging reorders siblings only. Selection-based reparenting is a different operation. The inspected list UI does not provide an item move into another list; copying through export/import creates new identities instead.

Folder relocation uses a “mark for move, navigate, place here” interaction. That move marker is unrelated to hashtags in names. Folders cannot be moved into themselves or their descendants. The home UI rejects archived destinations; lists cannot be placed at the root.

Sources: [selected roots and move validation](../src/lib/hierarchy.ts), [reparenting](../src/lib/data.ts), [folder relocation](../src/lib/components/HomeScreen.svelte), [item selection and drag](../src/lib/components/ListScreen.svelte).

### 4.3 Reorder through a filtered window

The home screen may show only some siblings because of tags, completion, or archival. Its reorder operation identifies visible neighbors, relocates the dragged entity relative to those neighbors in the full sibling collection, and then assigns positions. Hidden siblings are not deleted by reordering.

Item drag uses original sibling indices from the tree projection. A rewrite should keep displayed positions, underlying positions, and entity identity distinct rather than treat a filtered row index as the canonical position.

Sources: [mixed and filtered reorder helpers](../src/lib/data.ts), [home drag](../src/lib/components/HomeScreen.svelte), [item drag](../src/lib/components/ListScreen.svelte).

## 5. Completion is a configurable interpretation

### 5.1 Single-checkbox and named-checkbox modes

With no configured names, ordinary task completion uses the task's legacy checked flag. With named checkboxes, it uses the state of the last configured checkbox. Earlier states are independent toggles, not prerequisites enforced by the application.

A folder supports up to eight named checkboxes through its configuration actions. Each has stable identity and an editable label. Labels are trimmed, line/tab separators are collapsed, length is capped at forty characters, and empty or case-insensitive duplicate labels are rejected by add/rename actions.

Changing checkbox order can change which state determines completion without modifying any item's checkbox values. Removing a checkbox leaves its item state behind but ignored. Removing the final configured checkbox returns to legacy checked semantics; it does not automatically translate named state into the old boolean.

**Reimplementation abstraction:** make “is this task done?” a policy evaluated from the task and its folder configuration. Do not embed different completion definitions independently in every screen.

Sources: [checkbox configuration and completion helpers](../src/lib/data.ts), [independent checkbox storage](../src/lib/folderCheckboxes.ts).

### 5.2 Separate progress, completion, and container status

“Any checkbox selected” differs from “done.” Bulk uncheck clears every configured checkbox, not just the completion-determining one. Compact task controls, including nearby task completion, toggle the final checkbox or the legacy checked flag.

Item counts and price totals exclude headings and notes. Folder/list completion remains independent of task completion. Deleting checked tasks uses subtree deletion, so unfinished children of a deleted completed parent can also be removed. Confirmation counts need not equal the number of descendant records ultimately removed.

Sources: [list counts, bulk actions, and compact completion](../src/lib/components/ListScreen.svelte), [nearby completion and cascading deletion](../src/lib/data.ts).

## 6. Derived views over the same content

### 6.1 Completion filters

The home folder view filters folder/list rows using their own manual done flags. Folder filter choices are shared metadata; the root filter is temporary local UI state. A folder filter does not automatically set the filters of its contained lists.

A list independently shows all tasks, only done tasks, or only unfinished tasks using its folder's completion policy. Headings and root notes remain visible in these filtered views. Child notes remain visible when their parent is visible, including a visible child note's own note descendants. Ordinary child tasks are evaluated independently, so a matching child task can appear even when its parent task is hidden.

Sources: [home filters](../src/lib/components/HomeScreen.svelte), [filtered item-tree projection](../src/lib/components/ListScreen.svelte).

### 6.2 Archive as inherited visibility, not deletion

Archiving preserves content and records neighboring same-kind siblings for restoration. Unarchiving tries placement after the surviving previous neighbor, then before the next neighbor, then at the front or end depending on the remembered position. It does not guarantee exact original placement after arbitrary other changes. Folder and list restoration tracks same-kind neighbors, not the complete mixed folder/list arrangement.

The archive browser is virtual. It shows archived subtree roots and non-archived ancestors needed to reach archived content. Inside an archived folder, all its children are navigable; inside an ordinary path-through folder, only relevant archived content and paths appear. An explicitly archived list whose folder is missing can appear at the archive root.

Sources: [archive/restore and effective archive helpers](../src/lib/data.ts), [archive projection](../src/lib/components/HomeScreen.svelte).

### 6.3 Favourites and pins

Favourites are a mixed shortcut collection of folders and lists with independent ordering. Effectively archived content is excluded. Favourite status does not change containment or completion.

Pins are item shortcuts drawn across non-archived lists. They are available from home and list screens, even for notes or headings. A home pin opens its owning list. In a list screen, an ordinary task pinned from that same list can toggle completion; a foreign pin or note/heading navigates to its owning list. Pins do not automatically bubble rows to the top of the underlying item tree.

Sources: [shortcut projections and interactions](../src/lib/components/HomeScreen.svelte), [list pin and favourite bars](../src/lib/components/ListScreen.svelte), [favourite ordering](../src/lib/components/FavouritesOrderScreen.svelte).

### 6.4 Search, tags, and references

Search is case-insensitive substring matching across folder, list, and item names, with newest creation times first and missing creation times last. Results retain entity kind and contextual path. An unfinished-only option removes done lists and done items, including items in done lists; it does not apply the same rule to folders.

**Current behavior:** the global search collection is not archive-filtered. Do not equate normal home visibility with global search visibility.

Hashtags are embedded in names rather than maintained as a separate user tag catalog. Extraction recognizes word-character tokens at the start or following whitespace, lowercases them, and removes the hash marker. Rendering and extraction use different matching rules, so not every visually highlighted tag necessarily has the same semantic interpretation.

The home tag bar filters immediate folder/list children and is assembled before the active tag filter, so a zero-result filter does not erase the available choices. Clicking an item's tag from a list opens global search. Autocomplete suggests existing tags, up to six at a time.

Names can also contain external web links and identity-based references to items, lists, or folders. Reference labels are resolved from current names; missing targets display a placeholder. An item reference opens the owning list, without necessarily highlighting the referenced row. Nearby and search navigation can explicitly request a highlighted item.

Sources: [tag and reference parsing](../src/lib/tags.ts), [home search and tag scope](../src/lib/components/HomeScreen.svelte), [list reference navigation](../src/lib/components/ListScreen.svelte).

### 6.5 Reports are membership-based projections

A smart-folder report is a name plus a set of assigned folder identities. It does not move content, duplicate lists, or express an arbitrary saved query. One folder can belong to multiple reports. Empty memberships do not produce a visible report name.

The report selects non-archived assigned folders and their directly contained non-archived, unfinished lists. It does not recursively include lists in unassigned descendant folders. It begins with unfinished root tasks, excluding root notes and headings, and recursively includes unfinished child tasks and child notes beneath the included roots. It omits empty list/folder blocks. A heading or completed task excluded during this recursion also prevents its descendants from being traversed in the report, even though the ordinary list tree can still render them.

The favourites report chooses folders that are favourites or have directly contained favourite lists. Within those folders it includes favourite lists, or all eligible direct lists when the folder itself is favourite. It then applies the same unfinished-root-task projection.

Live report pages update from the workspace. Exported reports are generated, detached HTML/text presentations of that moment. The standalone live page's text-copy behavior and the generated export's reference resolution are not identical.

Sources: [memberships](../src/lib/reportAssignments.ts), [report operations](../src/lib/smartFolders.svelte.ts), [live report projection](../src/lib/components/SmartFolderReportScreen.svelte), [detached report generation](../src/lib/components/HomeScreen.svelte), [report route](../src/routes/report/[name]/+page.svelte), [favourites route](../src/routes/favourites/+page.svelte).

## 7. Prices and journals

A task's price is optional; a missing price contributes zero. Quantity is optional; a missing quantity contributes one. Totals include completed and unfinished ordinary tasks across the whole list, not just visible filtered rows. Contributions are rounded to integer cents before summation to avoid floating-point accumulation artifacts.

The UI permits negative prices and up to two decimal places. Quantity entry accepts up to four digits, disallows decimal/negative entry, and interprets empty or non-positive input as unspecified. These editor rules are stricter than the general stored numeric fields and backup validation.

Currency selection changes the displayed symbol, not stored amounts or exchange rates. Switching list presentation does not perform monetary conversion.

Journal display adds creation dates/times to non-heading rows. It does not sort the list chronologically. Journal copying is a separate chronological transformation, excludes headings, includes notes and completed items, and is not restricted to the active completion filter.

Sources: [totals](../src/lib/data.ts), [numeric editor, currency formatting, and journal transformation](../src/lib/components/ListScreen.svelte), [currency preferences](../src/lib/settings.svelte.ts).

## 8. Nearby errands as a functional pipeline

### 8.1 Derive errands from ordinary content

An errand is an existing item, its list, and effective tags. It is not a separately maintained task record.

1. Exclude divider lists and effectively archived lists.
2. Exclude heading items.
3. Normally exclude completed ordinary tasks; retain notes regardless of task-style checked state. The nearby screen requests completed candidates too so it can manage remembered checklist rows.
4. Use item tags when any exist; otherwise use list tags. These are alternatives, not a union. Folder tags do not enter this pipeline.
5. If the list is manually done, hide items inheriting its tags, but keep explicitly tagged items eligible.
6. Exclude entries with no effective tags.

Pausing is separate from collection: either an item pause or any effective normalized tag pause makes the errand paused. Resuming an individually paused item does not override an active hashtag pause. The original task, note, price, and completion state remain unchanged.

Sources: [collection and pause predicates](../src/lib/nearbyErrands.ts), [nearby candidate projection](../src/lib/components/NearbyErrandsScreen.svelte), [pause operations](../src/lib/data.ts).

### 8.2 Locations, origin, and matching

A destination has identity, name, coordinates, and matching tags, with optional address, source, shopping-centre name, and coordinate-accuracy category. The effective destination collection combines packaged Melbourne retail locations, packaged suburb centres, and shared user-created locations. Coordinate categories distinguish a store position, a shopping-centre position, and an approximate suburb position.

Tag normalization includes aliases and spelling variants. Some brand tags imply broader categories: selected supermarket brands match supermarket tasks, selected hardware brands match hardware tasks, and selected computer retailers match computer-parts tasks. A match requires at least one common effective tag, not all tags.

The starting point is one coherent value containing coordinates, source, label, accuracy, and update time. It can come from a GPS request or a selected suburb centre. It is saved and shared, not a continuously tracked route. Suburb shortcuts are an ordered, duplicate-free collection of known suburb identities; defaults are Melbourne, Brunswick, and Richmond. Editing the shortcut collection is a local draft until Save.

Suburb search normalizes spelling and accents, recognizes a mount abbreviation, and ranks exact names before prefixes, substrings, and tolerated spelling/transposition differences.

Distances are great-circle, straight-line distances. Invalid origins or non-positive/invalid radii produce no stops. A location within the radius becomes a stop only when it matches at least one eligible errand. Stops sort by distance, then location identity.

Sources: [locations and matching](../src/lib/retailLocations.ts), [suburb destinations](../src/lib/suburbLocations.ts), [origin](../src/lib/startingLocation.ts), [shortcuts](../src/lib/hotSuburbs.ts), [suburb search](../src/lib/suburbSearch.ts), [shortcut draft editing](../src/lib/components/HotSuburbsScreen.svelte), [nearby stops](../src/lib/nearbyErrands.ts).

### 8.3 Group and preview without losing task identity

Explicitly tagged items each form one errand group. Items using inherited list tags share their list's group. Task counts and errand-group counts are therefore different.

Nearby pills combine previews with matching tags. A group can appear when one of its tasks matches nearby, while its preview still represents active tasks in that group; a pill is not proof that every task has a nearby match. Preview text removes hashtags, joins task names, and summarizes remaining entries. The shared preview setting permits one through nine items and defaults to three.

Multi-task inherited groups expose a list-completion checkbox. It changes the parent list's done flag, not each task's completion, and therefore hides inherited-tag errands. Explicitly tagged tasks remain separately eligible.

General errands and banking errands can appear without a recorded destination. Their special tags keep them usable without an origin or matching saved place; the user chooses where to go. They are not automatically treated as unavailable destination-dependent errands when no nearby location matches.

Sources: [grouping](../src/lib/errandGroups.ts), [pills](../src/lib/nearbyPills.ts), [optional-location tags](../src/lib/nearbyErrands.ts), [group controls and coverage](../src/lib/components/NearbyErrandsScreen.svelte), [preview preference](../src/lib/data.ts).

### 8.4 Suggest coverage, not an optimized travel route

The suggestion algorithm repeatedly chooses the stop covering the most still-uncovered task identities. Ties prefer the nearer stop and then its identity. It removes selected stops made redundant by the others, sorts the remaining stops nearest-first, and assigns each reachable task to exactly one suggested stop.

The outputs are suggested stops, alternative matching stops, and tasks without a nearby match. This is a greedy coverage heuristic, not a guarantee of the smallest possible stop set or shortest journey. It does not calculate inter-stop driving distances, opening hours, appointment times, or a travel itinerary.

Displayed full-coverage counts operate at the errand-group level: every active task in a group must have a nearby match. Directions open an external maps service; approximate suburb destinations can use address text instead of presenting the centre coordinate as an exact storefront.

Sources: [suggestion algorithm](../src/lib/nearbyErrands.ts), [coverage and directions](../src/lib/components/NearbyErrandsScreen.svelte).

### 8.5 Completion, dismissal, and pause remain separate

The matched-task checklist is not merely the radius-filtered stop list. It can include supported tasks beyond the radius, location-optional tasks, remembered tasks, and completed tasks with remembered checklist state. Paused and dismissed candidates are removed from that active checklist. Completed remembered tasks remain until cleared.

Each remembered checklist entry pairs an item identity with a content fingerprint and dismissal flag. The fingerprint includes item content and metadata except sibling order, the list name, effective completion, and collaborative text formatting. It is not just the visible task name.

- Completing a task changes the original task's completion state.
- Completing an inherited group changes only its parent list's done flag.
- Dismissing a checklist row hides it without deleting or completing the source item.
- A dismissed unfinished task or note can return after its fingerprint changes.
- A dismissed completed ordinary task stays hidden even if edited; unchecking can allow it to return.
- Clearing completed entries dismisses them; it does not delete their source tasks.
- Automatic remembering of checklist membership is excluded from application undo; explicit completion and dismissal are user actions.

Sources: [dismissal predicate and fingerprints](../src/lib/nearbyChecklist.ts), [fingerprint construction and checklist commands](../src/lib/data.ts), [checklist derivation](../src/lib/components/NearbyErrandsScreen.svelte), [undo exclusion](../src/lib/yjsStore.svelte.ts).

## 9. Editing and interaction sessions

### 9.1 Plain-text editing and quick capture

The list screen uses one top text area for adding and renaming items. It remembers whether the operation is add or edit, the target identity, and an optional parent. Text does not become an item/name update until submitted. Price and quantity use separate temporary numeric buffers with save/cancel behavior.

Quick Add is an inbox-like operation independent of the current folder. It chooses the configured active top-level folder, otherwise the first active top-level folder, otherwise creates General. It finds a non-archived, non-divider list with the configured name using case-insensitive comparison, or creates a plain list. It then adds a task or note and stays ready for another entry. It does not automatically reopen a manually completed destination list.

Sources: [list input state machine](../src/lib/components/ListScreen.svelte), [quick capture](../src/lib/components/HomeScreen.svelte), [quick-add preferences](../src/lib/settings.svelte.ts).

### 9.2 Full-screen collaborative note sessions

Ordinary note editing uses the same text area as other names. Full-screen notes use a Quill editor bound directly to collaborative item text, with no visible formatting toolbar configured. Full-screen changes are already shared while editing; Save is not the first synchronization boundary.

The editing session has its own selective undo history. Save groups its accumulated edits into one application undo action and keeps the editor open. Cancel with changes requests confirmation and selectively reverses that session's edits, rather than replacing text with an old string that could overwrite peer changes. Close can offer discard, save-and-close, or continued editing. Unexpected navigation/unmount retains already-synchronized edits and records them in application undo history.

Historical note viewing is read-only and currently initializes the viewer from plain text rather than binding to editable historical rich text.

Sources: [note editing sessions](../src/lib/noteEditing.ts), [full-screen editor](../src/lib/components/FullScreenEditor.svelte), [collaborative text compatibility](../src/lib/noteText.ts).

### 9.3 Selection and stale-action safety

Selection is a temporary set of item identities, separate from completion. It can start from the menu or a half-second long press. It supports selected deletion, subtree reparenting, and selection-aware export/uncheck operations.

When a peer deletes an edited or selected entity, stale editor targets and selected identities are cleared. Changing lists or historical documents invalidates pending clipboard reads, dialogs, drags, and edit buffers. File restore and GPS requests also check that their original context is still current before applying delayed results.

**Reimplementation abstraction:** every delayed operation carries a destination identity and context lifetime. A result must not be applied merely because it completed successfully.

Sources: [list context guards](../src/lib/components/ListScreen.svelte), [home navigation guards](../src/lib/components/HomeScreen.svelte), [restore guards](../src/lib/components/SettingsScreen.svelte), [GPS request guards](../src/lib/components/NearbyErrandsScreen.svelte).

## 10. State ownership, synchronization, and accounts

### 10.1 Three distinct state lifetimes

| Lifetime | Examples | Meaning for a rewrite |
| --- | --- | --- |
| Shared workspace state | Content, checkbox definitions/states, favourite ordering, report membership, custom locations, origin, suburb shortcuts, checklist dismissal, pauses, commits, folder/list filter choices. | Persist and synchronize across devices for the same account. |
| Device-local, account-keyed preferences | Currency symbol, theme, handedness, insertion preferences, report font size, spacing, shortcut bindings, favourite-bar collapse, Quick Add destination/name. | Keep separate from shared content; changing one device need not change another. |
| Temporary or tab-local interaction state | Search, active tag, root filter, nearby radius, open screen, selection, edit buffers, move marker, pending confirmations; cursor memory in session storage. | Do not mistake UI context for workspace entities. |

Browser navigation represents home, folder paths, lists, and nearby errands in the URL and supports back/forward. Report and favourites pages are separate live routes. A copied identity reference is not a public access grant.

Sources: [shared document](../src/lib/yjsStore.svelte.ts), [local settings](../src/lib/settings.svelte.ts), [navigation and temporary state](../src/lib/components/HomeScreen.svelte), [list cursor memory](../src/lib/components/ListScreen.svelte), [nearby radius](../src/lib/components/NearbyErrandsScreen.svelte).

### 10.2 Offline-first account workspace

Each authenticated username has its own shared document and browser-local persistent cache. The client loads local persistent state before connecting to the server. Local edits can proceed offline and later merge. Connection status distinguishes offline, connecting, and synchronized; synchronized is not a validation of every possible business rule.

The app may optimistically use a cached username while verifying the server session. Network errors, server failures, and malformed responses do not by themselves revoke local access. An explicit authentication rejection clears that access. If the verified username differs from the optimistically loaded one, the document and local preferences are switched to the verified account.

Sign out only clears client login state after the server confirms revocation or reports the session already unauthorized. A failed network logout leaves local data usable and allows retry. Destroying the current document connection is not deletion of its persistent browser cache.

The server permits synchronization only for the authenticated user's exact document room. Sessions can expire or be revoked, and credential changes are checked against active sessions. There is no inspected multi-user sharing or per-folder permission model; collaboration is between clients using the same account workspace. Report pages require the user's session too.

Sources: [authentication behavior](../src/lib/auth.svelte.ts), [account reconciliation](../src/lib/sessionDocument.ts), [client document lifecycle](../src/lib/yjsStore.svelte.ts), [HTTP session operations](../server/auth-http.ts), [socket authorization](../server/auth-websocket.ts), [server session verification](../server/auth.ts).

### 10.3 Preserve independent edits

The implementation gives separate shared update units to entity fields, named checkbox states, checkbox configuration entries, report-folder membership pairs, and text characters. Independent offline edits to different checkbox states or report memberships should not overwrite one another as an entire replaced collection would.

Legacy item names remain readable. Collaborative text becomes authoritative once initialized, and the old name field is a compatibility mirror for older readers, including the terminal interface. Initialization is designed to be repeatable across offline replicas without duplicating the legacy text. Derived mirrors and migrations are not separate user undo actions.

**Reimplementation abstraction:** distinguish independently editable facts from coherent values. Independent membership facts merge separately; a starting location's coordinates and metadata move together as one coherent value. Conflict-free synchronization does not imply that every conflicting semantic intention can simultaneously win.

Sources: [checkbox representation](../src/lib/folderCheckboxes.ts), [item checkbox writes](../src/lib/data.ts), [report memberships](../src/lib/reportAssignments.ts), [text initialization and mirror](../src/lib/noteText.ts).

## 11. Undo, checkpoints, and portable copies

### 11.1 Application undo and historical commits

Application undo tracks local user changes for the current live document, rather than offering a global rollback of peer activity. Transaction boundaries define ordinary undo steps; full-screen note sessions can group their edits. The UI exposes undo with confirmation. Editor-local redo exists, but there is no equivalent general application redo control in the inspected screens.

Commits are named, timestamped checkpoints stored in the shared workspace. New checkpoints contain self-contained content state and omit nested commit history from that state. Older checkpoints can be read using their historical snapshot representation.

Opening a commit selects a separate read-only content document. Mutation helpers reject historical editing; leaving history returns to the live document rather than restoring the checkpoint over current content. The live workspace can continue synchronizing while a checkpoint is viewed. Local presentation settings are distinct from historical shared content.

Sources: [undo and checkpoint operations](../src/lib/yjsStore.svelte.ts), [checkpoint capture](../src/lib/commitSnapshot.ts), [history UI](../src/lib/components/CommitsScreen.svelte), [note session grouping](../src/lib/noteEditing.ts).

### 11.2 Item clipboard copies

Structured item export carries identity references, text, hierarchy, price/quantity, completion, and role/pin flags. Named-checkbox selections are carried by label for portability, not by their source-folder identities. It exports selected items when a selection exists, otherwise all items in tree order, not just visible filtered rows.

Import creates fresh item identities and maps exported parent relationships to those new identities. Parents must precede children; an unavailable parent becomes root placement. Matching named-checkbox labels are mapped case-insensitively to destination configuration. A legacy completed task imported into a named-checkbox folder marks every configured checkbox selected. Source creation dates, full-screen preference, and rich-text formatting are not included in this portable item export.

Plain clipboard import is a different operation: it makes one root task per trimmed line containing at least one letter. Numeric-only and blank lines are ignored. It is not a reconstruction of arbitrary tabular data.

Spreadsheet-style copy emits tab-separated data with metadata, hierarchy indentation, completion labels, and optional price/quantity columns and a spreadsheet total expression. This is integration with an external spreadsheet, not an internal spreadsheet editor. Journal copy is another lossy presentation-oriented export.

Sources: [clipboard exports/imports](../src/lib/components/ListScreen.svelte), [portable item restoration](../src/lib/data.ts).

### 11.3 Workspace backup and restore

Workspace backup includes folders, lists, plain item data, report memberships, custom locations, starting point, suburb shortcuts, preview preference, checklist state, pauses, and spreadsheet names/metadata. It is not a complete copy of the collaborative document: commits, rich-text formatting, sheet cell contents, account sessions, and device-local settings are omitted.

Merge restore updates matching identities and inserts new identities without deleting unrelated records. Report and pause restoration adds supplied memberships in merge mode rather than interpreting missing entries as removals. Replace restore clears the exported content collections and relevant auxiliary state before installing the backup. It does not erase the existing commit collection.

The implementation validates supported import sections before mutation because shared transactions are not rollback-on-error database transactions. Validation does not constitute exhaustive referential integrity: missing parents can still be interpreted by the recoverable tree readers. Restore is a content operation, not a replay of the original collaboration history.

**Current inconsistency:** the restore confirmation says the action cannot be undone, while the live document's undo mechanism and import transaction are designed to retain an undo baseline. A rewrite should explicitly settle that user-facing promise rather than copy both claims unchanged.

Sources: [backup, validation, and import](../src/lib/data.ts), [restore workflow and warnings](../src/lib/components/SettingsScreen.svelte), [local undo policy](../src/lib/yjsStore.svelte.ts).

## 12. Supporting and limited interfaces

### 12.1 Installed app and local-cache maintenance

The app has an installable offline application shell. Packaged location data travels with the client rather than requiring a fresh network lookup for each nearby request. Authentication requests remain network operations, not cached successful-login responses.

Cache tidying merges stored collaborative updates without deleting the database, replacing offline content with a server copy, or intentionally discarding history. It runs automatically and can be requested from settings. The user sees load timing, compaction status, and errors.

Sources: [PWA configuration](../vite.config.ts), [cache compaction](../src/lib/localCache.ts), [cache status](../src/lib/yjsStore.svelte.ts), [cache controls](../src/lib/components/SettingsScreen.svelte).

### 12.2 Spreadsheet compatibility remnants

The data layer still supports sheet metadata and sparse coordinate-addressed cell strings. Existing sheet rows can be listed, renamed, inspected, and deleted from home. However, opening a sheet leads to an explicit unsupported-feature notice recommending an external spreadsheet. There is no active spreadsheet grid or formula evaluation in that web screen.

Do not count remaining cell helpers as a currently implemented user-facing spreadsheet editor. A rewrite can either preserve legacy readability or deliberately migrate it, but that is a separate decision from implementing the active list features.

Sources: [sheet helpers](../src/lib/data.ts), [existing sheet rows](../src/lib/components/HomeScreen.svelte), [unsupported sheet screen](../src/lib/components/SpreadsheetScreen.svelte).

### 12.3 Terminal interface

The terminal client uses the same account synchronization model but is a limited alternative presentation. The inspected home view displays a flat collection of lists; the item view displays stored names and the legacy checked flag, with keyboard browsing, toggle, and back navigation.

Those views do not implement the web interface's named-checkbox completion policy, item-tree rendering, pricing controls, rich-note editing, reports, errands, favourites, or content creation/deletion. A terminal checkbox toggle therefore need not complete a task in a folder configured with named checkboxes. Terminal parity is not a safe assumption.

Sources: [terminal home](../tui/views/HomeView.tsx), [terminal items](../tui/views/ListView.tsx), [terminal store](../tui/store.ts), [terminal subscriptions](../tui/hooks.ts).

## 13. Reusable functional boundaries for a rewrite

These boundaries are extracted abstractions, not a prescription to reproduce the existing files or framework:

1. **Identity and content ownership:** resolve entities and containment without relying on names or displayed indices.
2. **Recoverable hierarchy:** interpret parent links consistently and separate readable recovery from persisted structural edits.
3. **Ordered-container operations:** insert, reorder, and restore positions while retaining identity and hidden siblings.
4. **Completion policy:** interpret task states from folder configuration, separate from container completion.
5. **Content commands:** create, rename, delete subtree, archive, restore, relocate, toggle state, pin, and favourite.
6. **Workspace projections:** derive home rows, filtered item trees, shortcuts, search results, and reports from the same content.
7. **Text interpretation:** extract semantic tags, render links/references, and resolve reference labels without rewriting source text.
8. **Errand pipeline:** derive eligible tasks, apply pauses/dismissals, match destinations, group previews, and suggest coverage.
9. **Interaction sessions:** manage drafts, selection, confirmation, and selective cancellation with destination/lifetime guards.
10. **State ownership:** distinguish shared content/preferences, account-keyed local settings, and transient navigation/edit state.
11. **Synchronization and access:** preserve offline work, isolate account documents, and reconcile verified sessions with cached access.
12. **History and portability:** keep undo, read-only checkpoints, content backups, and lossy clipboard presentations distinct.

For each boundary, specify its inputs, its derived outputs, its state-changing commands, and its failure/no-op conditions in English before choosing storage or UI technology.

## 14. Behavioral checks to carry into a reimplementation

These are suggested acceptance scenarios derived from the inspected code, not a report of newly executed tests.

- Renaming an entity leaves its identity, child relationships, and references intact.
- Moving a list changes its effective folder workflow and copies destination color, without automatically translating old checkbox states.
- Concurrent changes to different named checkboxes and different report memberships preserve both independent changes.
- Reordering named checkboxes can change task completion without changing the task's stored selections.
- Marking a folder/list complete does not mark its children complete.
- Turning a task into a heading clears its task values but leaves existing descendants readable.
- Reading partial synchronization with a missing parent does not permanently rewrite the parent link.
- Concurrent cyclic moves produce a consistent readable tree across replicas.
- Selecting a parent and descendant moves one subtree, not two detached nodes.
- New child creation and reparenting enforce three visible levels while old deeper trees remain readable.
- Reordering filtered home rows retains hidden siblings and uses visible neighbor identities.
- Archiving an ancestor hides descendants from normal views without deleting their content or changing each archive flag.
- List filters retain root notes/headings and appropriate child notes without pretending the result is a complete visible ancestry tree.
- Price totals do not change merely because completion filtering hides a row.
- Journal display adds dates; journal export independently sorts chronology.
- Reports include direct assigned-folder lists and eligible root-task branches, not every unfinished item anywhere below a folder.
- Explicit item tags replace inherited list tags; completing the list hides inherited errands but not explicitly tagged ones.
- Individual pause, hashtag pause, task completion, list completion, and checklist dismissal remain independent operations.
- Dismissed unfinished content can return after editing; dismissed completed tasks stay hidden until their state permits a return.
- Coverage suggestions assign each reachable task once and do not promise a shortest route.
- A group preview or group count does not falsely claim all of its tasks are nearby.
- Canceling a collaborative full-screen edit selectively reverses local session edits without restoring a stale whole-string copy over peer work.
- Late clipboard, file, GPS, drag, and confirmation results cannot modify a different screen/document context.
- Historical inspection never mutates live content, and leaving history does not restore over it.
- Offline/network errors preserve cached workspace access; explicit rejection and account switching reconcile the loaded document correctly.
- Backup and clipboard copy preserve only their documented content, and omitted formatting/history/cells are not promised as restored.
- Existing terminal and spreadsheet interfaces are treated according to their actual limited behavior rather than assumed web-feature parity.

## 15. Decisions to settle rather than silently inherit

A future implementation should explicitly decide whether to preserve or change the observed inconsistencies: stored folders-first preference versus mixed rendering, archive-inclusive search versus archive-excluding projections, report omission of root notes and excluded-parent branches, restore's undo warning, manual list completion after Quick Add, and legacy-only terminal completion.

The central pattern worth preserving is not a particular schema or framework: **one identity-based workspace, explicit state-changing operations, and multiple purpose-specific projections with clearly stated policies.**