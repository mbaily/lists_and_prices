# Deploying safely

Run `./deploy.sh --dry-run` in the server checkout to preview the frontend and
server file copy (requires an existing build). Run `./deploy.sh` to deploy.
The script requires Bash, sudo, rsync, flock, curl, Node/npm, and the existing
`lists-and-prices.service`. Run it as the checkout owner, not with `sudo ./deploy.sh`.

Deployment installs locked dependencies and builds before stopping production.
Production dependencies are prepared separately and the native SQLite addon is
checked against the server's Node version. It then stops the service, copies a
consistent backup, updates the runtime, and checks the served frontend and the
unauthenticated session endpoint. Concurrent deployments share a lock.

Only `build/`, server TypeScript files, `server/tsconfig.json`, package manifests,
and prepared dependencies are installed. Checkout `.env` files, credentials,
certificates, SQLite files and Yjs data are never copied into production. Existing
hashed frontend assets are retained for open tabs. `--delete` is limited to the
prepared `node_modules/` directory; the script refuses symlinked runtime directories.

Backups are retained in `/var/backups/lists-and-prices/deploy-*`, inside a root-only
directory. They include the old application/dependencies, entire live `server/`
directory (including SQLite sidecars and Yjs data), and root `.env*` files. Check
available disk space beforehand. Backups accumulate; remove old copies only after
checking your retention needs. A backup contains credentials and private notes.

On deployment or health-check failure, the previous application and dependencies
are restored and restarted. Live data is preserved: rollback does not overwrite
it with the backup. Check service status and logs after any failed deployment.
An incompatible backend data migration may require manual recovery from the
backup with the service stopped. Never copy a LevelDB/Yjs or SQLite backup over
an actively running service.

Defaults match this server: `/opt/lists_and_prices`, `www-data`, and
`https://127.0.0.1:8082`. Override with `LISTS_DEPLOY_DIR`, `LISTS_BACKUP_DIR`,
`LISTS_SERVICE_NAME`, `LISTS_SERVICE_USER`, and `LISTS_HEALTH_URL`. The backup
must be outside the deployment directory. TLS verification is disabled for the
local health check because the app uses a self-signed certificate. An HTTP
service can set an `http://` health URL.

The backup covers Yjs stored at `server/yjs-data`, as configured on this server.
If `YPERSISTENCE` points outside `server/`, arrange a stopped-service backup of
that location before deploying. This script is for an existing installation;
it does not provision a service, certificates, credentials or a new database.

The older `backup.sh` is separate and is not a consistent live backup: its
service-stop commands are commented out. Use deployment's stopped-service backup
or stop the service explicitly when taking a separate data backup.
