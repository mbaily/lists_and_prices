# Bug-fix and upgrade notes

## Fixed behavior

- WebSocket connections can access only the authenticated user's exact room. Existing room names are unchanged.
- Sessions are opaque, persisted in SQLite, expire on the server, and are revoked on logout or account/password changes. Revoked sockets stop reading and writing immediately when checked; idle sockets detect external account changes within 30 seconds.
- Failed logout keeps both authentication and the local document usable, with an error rather than a broken signed-in screen.
- Backup merge/replace restores per-checkbox states and authoritative note text, including empty notes. Imports are validated before destructive changes and can be undone.
- Notes initialize without duplicate baseline text when two updated clients open a legacy note offline. Save groups note changes into an application undo action; Discard selectively undoes this editor's unsaved changes without replacing peers' text.
- History is read-only, including Undo and note editors. New commits include independent checkpoints (without recursively embedding other commits), protecting them from legacy garbage-collecting replicas. Current server and TUI replicas retain deleted snapshot structs.
- Clipboard import can run repeatedly and cannot write into a different/deleted list after an asynchronous read.
- Reparenting checks depth, headings and cycles, preserves selected subtrees, and is transactional. Rendering retains legacy deep items and heading children. Concurrent folder/item cycles remain reachable through a deterministic recovered tree.
- New items append after the maximum sibling order rather than the sibling count.
- Independent report memberships and checkbox definition changes use separate CRDT keys rather than replacing entire arrays.
- Svelte type errors, obsolete spreadsheet drag handling, Quill SSR loading, and pre-effect initialization-order crashes are fixed.
- Local startup indexes items once when restoring note names, avoiding a full item-list scan for every note. The WebSocket handshake waits for IndexedDB restoration.
- The local Yjs update log compacts automatically after loading and once a minute while edits arrive. Compaction merges persisted updates in an atomic IndexedDB transaction, retaining offline changes, other tabs' writes, missing-dependency updates and historical structs. Settings offers **Tidy local cache** and displays load time; the destructive reset has been removed.

### Local cache verification (2026-09-30)

A disposable Chrome profile with 10,000 synthetic notes and 30 duplicate saved
updates loaded in 3,531 ms with the previous note observer, 1,568 ms with the
indexed observer, and 372 ms after compaction. The log shrank from 35,111,496 bytes
across 33 records to 1,170,383 bytes in one record. An offline edit survived reload.
These are synthetic measurements, not timings from a user's database.

Compaction removes duplicate storage and update replay overhead. It deliberately
retains CRDT history needed by old snapshots and offline peers, so growth of the
actual document/history is separate from redundant IndexedDB records. The first
load of an existing bloated cache still reads that cache; subsequent loads use
the compacted log. Transaction failures leave the original updates intact.

## Deploying

Before releasing, stage and commit the new server modules and regression tests along with the existing changes. Commits through `2e28b83` imported `server/auth.ts`, `server/auth-http.ts`, and `server/auth-websocket.ts` without including those files, so a clean checkout exits with `ERR_MODULE_NOT_FOUND` before listening. A cached PWA then reports API/Workbox and WebSocket connection failures. The release-startup tests check Git's index (the next commit) and boot a disposable copy of that server; working-tree-only files cannot mask this failure. No production credentials or database are copied.

1. Back up existing data, build the frontend, and restart the server with the updated code. No live deployment is performed by the tests.
2. **Sign in again.** Old signed-username cookies are intentionally rejected. The existing database gains a `sessions` table automatically; retain the database and its persisted session secret.
3. Refresh/update every device and installed PWA before editing note text, report assignments or checkbox definitions. Legacy stored data and version-1 JSON backups are readable, but older app versions do not understand the new per-entry fields.
4. New usernames must be 1–128 ASCII letters, digits, or `._~@+-`; passwords must be 1–72 UTF-8 bytes (bcrypt's limit). Run account-management commands under the server's OS account.

Optional server settings are documented in `.env.example`. The server reads `process.env`; export overrides in the service environment or launch Node with an appropriate env-file option. No override is required: a random secret is persisted automatically and sessions default to 30 days. Do not deploy the placeholder as a secret.

## Limits and verification

- Existing snapshot data already garbage-collected everywhere cannot be reconstructed retroactively. Keep any older device/backup that still has it. New checkpoints prevent that loss for newly created commits.
- JSON backup remains the existing version-1 format: it does not include version history or legacy spreadsheet cell contents. Commit checkpoints do include cells.
- `npm test` uses in-memory Yjs/SQLite and isolated loopback HTTP/WebSocket servers, never the real credentials or server database. The release-startup test creates and removes a temporary SQLite database beside copied server files. Stage release files before running this Git-index check. Component initialization tests run real Svelte pre-effects but are not full DOM tests.
- Browser smoke checks used a synthetic user and intercepted networking: note Save → Undo → reopen, selective Discard, historical note viewing, and initial Home/List rendering.
- Existing accessibility/unused-CSS warnings and npm dependency advisories remain separate maintenance work. No forced dependency-major upgrades were applied during these application fixes.
