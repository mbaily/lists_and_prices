# Offline storage and manual synchronization

## First load and server update logs

After browser storage is cleared, an empty local database is not proof that the
account is empty. The home screen displays a server-loading message until its
first state exchange completes. Previously confirmed offline caches continue to
open immediately. Automatic mode starts the HTTP exchange when local storage is
ready, without waiting for a WebSocket sync event; a recovered WebSocket also
brings the confirmation request ahead of a delayed retry.

The server prepares old update logs before listening and merges them periodically
after 64 appended records or 16 MiB of appended updates. This prevents repeated
full checkpoints from making each cold load replay hundreds of megabytes.
Merging uses the original binary updates, retains deleted structs and unresolved
dependencies, and preserves historical snapshots. Replacing records and deleting
duplicates commit atomically; metadata and the highest update clock are retained.
The resulting files remain compatible with the existing y-leveldb format.
The adapter in `server/persistence.ts` uses the pinned y-leveldb 0.1.2 transaction
interface. Test its compatibility before changing that dependency.

The first startup after upgrading a large old log may take several seconds to
prepare it. Subsequent cold loads read the merged update. Tests cover failed
atomic writes, concurrent writes, snapshot recovery, missing dependencies and
legacy-reader compatibility.

## Device storage and synchronization

Use the existing Home Screen PWA. Settings → Offline & sync shows local-save
completion, offline UI availability, browser storage protection, pending server
confirmation and the last completed server sync. Automatic sync remains the
default. Turning it off persists a per-account preference on this browser and
disconnects the WebSocket provider; reopening, coming online and returning to
the foreground respect that preference. Other tabs on the same origin observe
preference changes. Sync now performs one exchange without enabling automatic
connections. Open the app to sync; background execution is not required.

F5, Ctrl+R and Cmd+R refresh data in place once local storage is ready and the
page has keyboard focus. The
current screen, pinned items, scroll position and unfinished input stay mounted
while the app rereads local updates and synchronizes online. Offline or expired
sessions still reread local data without discarding edits. Browser toolbar
Reload, pull-to-refresh and shortcuts used outside the page retain the browser's
normal full-reload behavior; page code cannot intercept those browser actions.
No separate saved view is used. Ctrl+Shift+R, Cmd+Shift+R and Ctrl+F5 perform a full
reload, and service-worker updates still reload the application code normally.

The client requests `navigator.storage.persist()` at startup and through Protect
offline storage. A refusal is shown as best-effort storage, not as protection.
Storage estimates cover the origin, including app assets and account caches.
A controlling service worker and cached HTML/current bootstrap styles and modules
are checked separately for offline launch readiness. This does not imply the data
is saved or synchronized. Manual device verification is still necessary. Use the
same origin and Home Screen installation throughout.
Removing the installation or clearing its data can remove unsynchronized work.

## Data compatibility and save confirmation

`LocalPersistence` opens the existing `pnl-<username>` database and its `updates`
and `custom` stores without deleting or migrating it. The update bytes remain
compatible with y-indexeddb, including deleted structs, historical snapshots and
updates whose dependencies have not arrived. Local save status follows IndexedDB
transaction completion, using strict durability. Failed writes stay queued in
memory and can be retried. Initial edits are saved before initialization reports
completion. Existing atomic cache compaction remains enabled.

Pending-sync metadata is written in the same transaction as document changes.
It tracks deletion-only changes too: a Yjs state vector alone cannot detect them.
Last-sync metadata is committed only after the server acknowledges persistence,
and is retained across reloads. The last acknowledged update key also detects
writes from older clients that do not maintain this metadata. An intervening
write by another tab or compaction conservatively leaves sync pending; another
exchange reloads all stored updates and confirms them.

## Server exchange

Authenticated POST requests to `/api/sync/state` and `/api/sync` use binary
`application/octet-stream` messages. `syncProtocol.ts` encodes the account name,
Yjs state vector and update as lib0 length-prefixed fields. Requests are limited
to 64 MiB and responses use `Cache-Control: no-store`.

The first request sends a state vector and no update, and receives the server's
missing updates and state vector. The second sends the client's missing update,
including its delete set. The server uses the same live document and persistence
lease as WebSockets and the task API, awaits cold loads, applies the update, and
waits for a successful LevelDB stored-update clock before replying. A rejected
or silently failed store cannot produce a success acknowledgement. The first
checkpoint covers the complete live document; later checkpoints during that live
session store differences from a confirmed vector, including delete sets, rather
than repeatedly appending the entire history.

The account in the message must match the current session before upload data is
applied. Expired/revoked sessions and account mismatches request sign-in while
retaining the local document. Settings reauthenticates the cached account and
syncs that same document. Failed or timed-out exchanges keep work pending;
automatic mode retries while the app is open. Late responses cannot mutate a
replacement document or mark edits made during the request as synchronized.
Changes made during a manual exchange may require another Sync now.

Deploy the client and server together: the confirmation endpoints are new.
Server dependencies require Node 22 or newer; checks were run with Node 24.

## Verification

Automated tests cover old/new provider compatibility, restart recovery, deletion
tracking, failed-write retries, cross-tab writes, manual connection controls,
reauthentication and account isolation. An integration test advances the server
clock a week, reloads the client's IndexedDB state offline, merges another
device's changes, and reauthenticates an expired session before synchronizing.
All database and server fixtures are disposable; production data is not used.

A production-build Chrome smoke check covers offline UI edits, a complete browser
restart while offline, cached launch, retention of manual mode, and explicit
resynchronization. WebKit UI editing and manual resynchronization also passed
with the origin server stopped and restarted. The local automated WebKit runtime returned an empty cache
even immediately after a separate Cache API put; offline launch could not be
validated with that runtime. Verify the actual iPhone separately.

On the actual iPhone, before relying on an extended offline period:

1. Open the installed Home Screen app online and choose Protect offline storage.
   Check its reported outcome, offline launch readiness and local-save status.
2. Turn off automatic sync, choose Sync now and wait for server confirmation.
3. Enable airplane mode, make an edit, and wait until it is saved on the device.
4. Close the app completely, restart the phone and reopen it while offline.
   Verify the edit and make another one.
5. Make a separate edit from another device while the phone remains offline.
6. Restore connectivity. Confirm that manual mode stays selected and pending
   work remains until Sync now is chosen. Reauthenticate if requested, then
   verify both devices' edits after synchronization.
