# Deploying safely

## Release version policy

Every production deployment must increase the web client's version, including
deployments containing only server or deployment changes. Use `MAJOR.MINOR.PATCH`;
increment PATCH by default, or deliberately choose a new minor/major release.
The version at the bottom of Settings comes from `package.json` and is compiled
into the web client. SvelteKit's `/_app/version.json` uses that same version.

Before committing and pushing a release, run:

```sh
npm version patch --no-git-tag-version
```

Commit `package.json` and `package-lock.json` with the release changes, then push
and deploy that exact commit. Do not bump versions only on the server or after
building: the source, lockfile, client bundle and deployed version must agree.

`deploy.sh` rejects unchanged/older versions and inconsistent lockfile versions
before installing dependencies or stopping production. It verifies the built
version before deployment and the served version during health checks. A dry
run only previews file copies and does not require a version bump.

A failed deployment can retry its version if the older release is still live.
After a successful deployment, another deployment needs a new version. Automatic
rollback restores the previous version along with its application; it does not
increment the version. Offline PWA clients continue showing their cached version
until they reconnect and load the update.

## Deployment procedure

Run `./deploy.sh --dry-run` in the server checkout to preview the frontend and
server file copy (requires an existing build). Run `./deploy.sh` to deploy.
The script requires Bash, sudo, rsync, flock, curl, Node/npm, and the existing
`lists-and-prices.service`. Run it as the checkout owner, not with `sudo ./deploy.sh`.

Deployment installs locked dependencies and builds before stopping production.
Production dependencies are prepared separately and the native SQLite addon is
checked against the server's Node version. It then stops the service, copies a
consistent backup, updates the runtime, and checks the served frontend/version and the
unauthenticated session and sync endpoints. Concurrent deployments share a lock.

Only `build/`, server TypeScript files, `server/tsconfig.json`, the shared
`src/lib/folderDefaultItems.ts` and `src/lib/syncProtocol.ts` modules, package manifests, and prepared
dependencies are installed. Checkout `.env` files, credentials,
certificates, SQLite files and Yjs data are never copied into production. Existing
hashed frontend assets are retained for open tabs using the policy below. `--delete` is limited to the
prepared `node_modules/` directory; the script refuses symlinked runtime directories.

Frontend compiler, PWA tooling, TypeScript type checking, browser-only packages
and terminal UI dependencies are development dependencies. Production still
includes `tsx` because the backend executes TypeScript; removing the whole
`node_modules` directory would break startup. Staging uses `npm ci --omit=dev`
and validates the native SQLite addon before the service is stopped.

## Frontend asset retention

After successful health checks, deployment keeps immutable assets belonging to
the latest three releases and all releases deployed in the last seven days.
Shared assets stay while any retained release needs them. This provides a
bounded compatibility window for open tabs and cached PWAs; older clients may
need to refresh once that window expires.

The first deployment with this policy records existing production assets as a
legacy baseline, preserving them for a full seven days regardless of their
build timestamps. A later successful deployment expires that baseline and any
other eligible assets. Future deployments record the exact staged build, so
old assets no longer accumulate indefinitely. History lives in the root-only
`LISTS_BACKUP_DIR/frontend-assets/` directory. Keep that directory when moving
deployment backups; it is retention metadata, not an application/data backup.

Cleanup touches only tracked regular files below `build/_app/immutable/`, rejects
symlinked asset paths, and never touches server state, credentials or databases.
Failures before successful health checks do not prune assets. A cleanup error
after activation is reported with a nonzero exit status and leaves the healthy
application running.

## Backups and rollback

Backups are retained in `/var/backups/lists-and-prices/deploy-*`, inside a root-only
directory. They include the old application/dependencies and shared modules, entire live `server/`
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
