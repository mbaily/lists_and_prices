# Server user data

Export this in the server's systemd environment to group persistent state:

```ini
[Service]
Environment=LISTS_DATA_DIR=/encrypted/web_apps_data/lists_and_prices
UMask=0077
```

This selects:

| Store | Default under `LISTS_DATA_DIR` | Independent override |
| --- | --- | --- |
| SQLite sessions and persistent signing key | `server.db` | `LISTS_DB_PATH` (file path) |
| Y-LevelDB user documents, history and metadata | `yjs-data/` | `YPERSISTENCE` (directory) |
| Task-token hashes, permissions and destination bindings | `task-tokens.json` | `LISTS_TASK_TOKENS_PATH` (file path) |

Individual overrides take precedence over the common root. Relative paths are
relative to the process working directory. Parent directories are created with
mode 0700 when missing; existing directory modes are preserved. Give the service
account ownership/access and use `UMask=0077` for newly created state files.
Variables must be exported or set through systemd: `.env` is not loaded by the
server or the task-token command.

The password file remains `server/.htpasswd` beside deployed server code. TLS
certificate/key files also retain their existing deployment paths. These files
are independent of the user-data root. A data backup excludes `.htpasswd`; keep
credentials separately if you need to restore accounts.

Without `LISTS_DATA_DIR`, SQLite and task tokens retain their existing
`server/server.db` and `server/task-tokens.json` defaults. Yjs persistence retains
its existing `YPERSISTENCE` behavior; without either variable it is disabled.
Setting the common root enables Yjs persistence at its `yjs-data/` default before
the upstream WebSocket module loads. The actual filename is **task-tokens.json**
(singular `task`), not `tasks-tokens.json`.

## Migrating an existing installation

1. Stop the service and other writers, including token-issuing commands. Take a
   consistent backup before changing storage. Existing data is not automatically
   moved or copied by setting these variables.
2. Create the new private root owned by the service account, normally `www-data`.
   Move/copy `server/server.db` with any outstanding `-wal`/`-shm` state handled
   consistently, the **entire** selected Yjs directory, and `server/task-tokens.json`
   if it exists. A SQLite `.backup` snapshot incorporates WAL state into one file.
   Keep `.htpasswd` in the deployment directory.
3. Add `LISTS_DATA_DIR` to the service configuration. Remove or update any old
   explicit storage overrides. In particular, this host's base service currently
   sets `YPERSISTENCE=./server/yjs-data`; it wins over the root unless unset or
   changed. A systemd drop-in can reset that inherited variable with:

   ```ini
   [Service]
   Environment=LISTS_DATA_DIR=/encrypted/web_apps_data/lists_and_prices
   UnsetEnvironment=YPERSISTENCE
   UMask=0077
   ```

   Update any local writable-path restrictions for the new directory, reload
   systemd, and restart. Token issuance must use the same path environment; see
   [task integration](task-api.md). Test login, document sync and task imports.
4. After verification and retaining a protected backup, retire the old SQLite,
   Yjs and token files from the deployment directory. Do not leave two independently
   writable copies and accidentally start a client/server against the old one.

SQLite is server authentication/session state; user documents are in Y-LevelDB.
Restoring one without the other is not a complete app restoration. The task-token
file contains hashes rather than the callers' raw bearer tokens, plus user/list
permissions and bindings that `/api/tasks/destination` updates. Back it up with
the documents. Raw tokens remain with callers and are written only to the private
output file explicitly selected by the token issuer.

## User-data backups and restore

```sh
# Normal mode reads the installed service's actual environment and restarts it
# after a stopped-service backup. sudo is used internally where required.
bash backup.sh /absolute/private-backups/lists-2026-10-25

# For an already stopped service, export exactly its storage configuration.
LISTS_DATA_DIR=/encrypted/web_apps_data/lists_and_prices \
  bash backup.sh /absolute/private-backups/lists-offline --offline
```

`--service NAME` and `--server-dir DIRECTORY` select a different installation;
defaults are `lists-and-prices.service` and `/opt/lists_and_prices/server`.
Use Node 24 and the app's installed dependencies. Standalone backup destinations
must be new directories; existing backups are never overwritten. The offline
mode refuses an open LevelDB lock, but all writers must remain stopped throughout
the copy. In particular, do not issue tokens while a backup runs.

The private backup contains `server.db`, `yjs-data/`, optional `task-tokens.json`,
and `manifest.json` recording original locations and whether tokens existed.
The SQLite snapshot includes outstanding WAL changes. `.htpasswd` is excluded,
even if a stray copy is present in the data directory. No whole-root directory
copy is used. TLS credentials and application code are also outside this snapshot.

To restore, stop all writers, retain the current state, install the three backed-up
stores at their configured paths, restore ownership/private permissions, and
restart. Restore the SQLite snapshot without stale WAL/SHM files from a different
database. Restore the complete LevelDB directory. If the manifest says there was
no token file, do not retain an unrelated newer token file from the destination.
Provision `server/.htpasswd` separately; restored sessions/tokens still require
matching accounts/credentials. The deployment script also takes this data
snapshot, alongside its code rollback backup, and never rolls live user data
back automatically when reverting application code.

Browser localStorage/IndexedDB and unsent offline edits remain in browser profiles;
these server path settings and backups do not relocate that client state.
