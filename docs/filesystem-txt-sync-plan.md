# Bidirectional Filesystem & TXT Format Sync Plan (Vim & CLI)

This plan specifies a non-daemon, on-demand command-line tool and human-friendly plain-text file format that allows editing an entire user dataset (folders, lists, hierarchical items, prices, notes, and wiki pages) using `vim` on Linux (and Windows), with two-way idempotent synchronization back into the Yjs CRDT store.

---

## 1. Executive Architecture Summary

### Core Requirements Addressed
1. **On-Demand Execution**: No persistent daemons or background processes. The user runs a command (e.g. `lists-sync` or `npm run sync-fs`) when they want to pull or push.
2. **Human-Friendly for Vim**: Clean indentation for hierarchy, simple Markdown/outline conventions, folded sections, no ugly inline UUIDs cluttering text.
3. **Folder & File Organization**:
   - Folders $\rightarrow$ Native filesystem directories.
   - All lists within a folder $\rightarrow$ A single `lists.txt` (or `todo.txt`) for frictionless multi-list review and rapid editing.
   - Wiki pages $\rightarrow$ Individual `.txt` files under `wiki/` matching their namespaces.
4. **Idempotence**: Running the command multiple times without editing produces **0 CRDT mutations** and 0 network/storage writes.
5. **Entity Creation**: Users can add new folders (by creating subdirectories), new lists (by adding `## List Name`), new items (by typing a new line with `- [ ]`), and new wiki pages (by creating a `.txt` file).

---

## 2. The Metadata Question: SQLite vs. `.yjs_metadata`

### User Question:
> *"Does this actually need a copy of the yjs data to do this? You can use an sqlite metadata database to accomplish this if needed. Does that suffice? Or do you need to copy the y-leveldb files over into the subdirectory into a '.yjs_metadata' folder?"*

### Recommendation: **SQLite Metadata (`.sync/metadata.db`) Suffices & Is Superior**

#### Why You Do NOT Need Full `y-leveldb` Files in the Subdirectory:
1. **Concurrency & Locking**: LevelDB acquires an exclusive file lock (`LOCK`). If the background web server or local replica is running, another process opening the same LevelDB directory will crash with an `IO error: lock ... Resource temporarily unavailable`.
2. **Portability**: LevelDB binaries have native C++ bindings that vary across platforms, node versions, and architectures.
3. **Clean Sync Protocol**: The sync tool can connect briefly using the app's established WebSocket / HTTP sync protocol (or direct in-memory Yjs load), fetch/push state vectors in $\sim$50ms, and cleanly exit.

#### Why SQLite Metadata (`.sync/metadata.db`) Is Ideal:
- **Clean Vim buffer**: Without UUIDs in `lists.txt`, lines look clean:
  ```text
  - [ ] Buy groceries @ $25.50
    ↳ Check if organic milk is available
  ```
- **Tracking Identity Across Edits**: SQLite maps `(folder_path, list_name, item_path, line_hash)` to internal Yjs `id`s.
- **Three-Way Diffing**: SQLite stores the *content hash* and *last synced state vector* from the previous sync. This enables detecting:
  - Text edited in Vim while Yjs was untouched $\rightarrow$ push to Yjs.
  - Text untouched in Vim while Yjs changed remotely $\rightarrow$ update text file.
  - Neither changed $\rightarrow$ **0 actions taken (idempotent)**.

```mermaid
flowchart LR
    A["Vim / User Files<br>(lists.txt, wiki/*.txt)"] <-->|Parser / Serializer| B["Sync CLI Engine<br>(lists-sync)"]
    B <-->|Line & UUID Mapping| C[".sync/metadata.db<br>(SQLite)"]
    B <-->|Yjs Sync Protocol<br>(HTTP / WS / Local)| D["App Yjs Store<br>(Server / Replica)"]
```

---

## 3. Directory Layout Specification

Given a sync root directory `~/lists_and_prices/`:

```
~/lists_and_prices/
├── .sync/
│   ├── config.json              # Endpoint URL, username, auth token
│   └── metadata.db              # SQLite: UUID maps, content hashes, state vectors
├── lists.txt                    # Root lists (lists without a parent folder)
├── Personal/
│   ├── lists.txt                # All lists in "Personal" (e.g. Daily, Groceries, Ideas)
│   └── Projects/
│       └── lists.txt            # Nested folder "Personal/Projects"
├── Work/
│   └── lists.txt                # All lists in "Work" folder
└── wiki/
    ├── start.txt                # Wiki page: start
    ├── syntax.txt               # Wiki page: syntax
    └── work/
        ├── project_alpha.txt    # Wiki page: work:project_alpha
        └── meeting_notes.txt    # Wiki page: work:meeting_notes
```

---

## 4. Plain-Text Format Specification

### A. Folder Lists File: `lists.txt`

All lists for a folder live together in one file. A list begins with `## ` (Markdown level-2 heading).

```markdown
# Folder: Work
# Color: #6366f1
# Checkboxes: DEV, TEST, PROD

## Fri 07/11/26 [plain]
- [ ] Prepare weekly report #ops
- [DEV, TEST] Code review PR #124 @ $150
  ↳ Subtask: Check edge cases for timezone parsing
  ↳ [note] Remember to run tests with --test
- [x] Send invoice to client

## Sat 08/11/26 [plain]
- [ ] Weekend maintenance window
  - [ ] Backup production database
  - [ ] Upgrade Redis cluster

## Expenses [priced, #22c55e]
- [ ] Hotel stay @ $240.00 x 2
- [x] Conference ticket @ $450.00
- === Pending Approvals ===
- [ ] Flight booking @ $620.00
```

#### Syntax Breakdown for Vim:
| Pattern | Meaning | Yjs Item Mapping |
| :--- | :--- | :--- |
| `## List Name [type, color]` | List declaration | `ListMeta { name, type, color }` |
| `- [ ] Task name` | Incomplete item | `Item { checked: false, note: false }` |
| `- [x] Task name` | Completed item | `Item { checked: true, note: false }` |
| `- [DEV, TEST] Task` | Named checkboxes checked | `Item { checks: { dev: true, test: true } }` |
| `  - [ ] Subtask` | Child item (indentation = 2 spaces) | `Item { parentId: parent.id }` |
| `  ↳ Note line` | Rich text note on parent | `Item.note = true` / Note text |
| `- === Section ===` | Divider / Heading | `Item { heading: true }` |
| `@ $12.50 x 3` | Price and quantity | `Item { price: 12.5, qty: 3 }` |
| `#tag` | Tag | Preserved in name / tag indexing |

### B. Wiki Page File: `wiki/<slug>.txt`

Wiki pages are saved directly in standard DokuWiki markup (the app's native wiki dialect):

```dokuwiki
====== Project Alpha ======

Welcome to the project documentation.

===== Objectives =====
  * First objective
  * Second objective with [[work:architecture|Architecture link]]

^ Component ^ Status ^ Cost ^
| Core API  | Done   | $500 |
| Frontend  | WIP    | $300 |

Detailed notes in [[list:work:tasks|Work Tasks List]].
```

---

## 5. Adding & Deleting Entities in Vim

### Adding a New List:
Append to `lists.txt`:
```markdown
## Groceries [priced]
- [ ] Apples @ $4.50
- [ ] Sourdough bread @ $6.00
```
On sync: CLI detects `Groceries` doesn't exist in `metadata.db` $\rightarrow$ calls `createList('Groceries', folderId, 'priced')`.

### Adding a New Folder:
Create directory `mkdir -p "Home/Garden"` and add `Home/Garden/lists.txt`:
```markdown
## Planting Schedule
- [ ] Plant tomatoes
```
On sync: CLI detects new folder path $\rightarrow$ calls `createFolder('Garden', parentFolderId)`.

### Adding a New Wiki Page:
Create `wiki/guides/vim_setup.txt`.
On sync: CLI detects page `guides:vim_setup` $\rightarrow$ calls `saveWikiPage('guides:vim_setup', content)`.

### Deleting an Entity:
- Remove a list block or line from `lists.txt` $\rightarrow$ on sync, the CLI detects the omission and archives or deletes the item in Yjs.
- Remove a file $\rightarrow$ soft-deletes / deletes the page or list.

---

## 6. Metadata Database Schema (`.sync/metadata.db`)

SQLite handles identity, content hashing, and ordering:

```sql
CREATE TABLE sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE entity_map (
    entity_type TEXT NOT NULL,      -- 'folder', 'list', 'item', 'wiki'
    yjs_id TEXT NOT NULL,           -- Yjs UUID
    rel_path TEXT NOT NULL,         -- e.g. "Work/lists.txt" or "wiki/start.txt"
    entity_key TEXT NOT NULL,       -- Path/line signature or item fingerprint
    content_hash TEXT NOT NULL,     -- SHA256 of line content
    last_synced_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, yjs_id)
);

CREATE INDEX idx_entity_lookup ON entity_map(rel_path, entity_key);
```

### Idempotency Guarantee:
1. When syncing:
   - Compute `hash(current_file_content)`.
   - If `hash(file) == stored_hash` AND `yjs_state_vector == stored_vector`, **no work is done**.
2. When modifications occur:
   - Only diffs are converted into `transact(() => { ... })` actions.
   - Text files are regenerated only if remote changes occurred, preserving line endings and formatting.

---

## 7. CLI Command Workflow

The CLI will be packaged under `scripts/lists-sync.ts` (executable via `npm run sync-fs` or standalone binary `lists-sync`):

```bash
# Pull remote/server data down to ~/lists_and_prices/
lists-sync pull ~/lists_and_prices/

# Edit in vim
vim ~/lists_and_prices/Work/lists.txt

# Push edits back to Yjs (idempotent, fast)
lists-sync push ~/lists_and_prices/

# Two-way sync (pull remote changes, merge local edits, push)
lists-sync ~/lists_and_prices/
```

---

## 8. Questions & Alignment Check

Before implementation begins:
1. **Default text file name**: Does `lists.txt` inside each folder sound right, or do you prefer `todo.txt` or `<folder_name>.txt`?
2. **Note lines**: Does `↳ Note text` or standard indented text work best for your vim workflow?
3. **Location of `.sync/` directory**: Should the metadata database live in `~/lists_and_prices/.sync/metadata.db`?
