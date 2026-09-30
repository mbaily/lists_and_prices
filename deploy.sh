#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${LISTS_DEPLOY_DIR:-/opt/lists_and_prices}"
BACKUP_ROOT="${LISTS_BACKUP_DIR:-/var/backups/lists-and-prices}"
SERVICE_NAME="${LISTS_SERVICE_NAME:-lists-and-prices.service}"
SERVICE_USER="${LISTS_SERVICE_USER:-www-data}"
HEALTH_URL="${LISTS_HEALTH_URL:-https://127.0.0.1:8082}"
source "$SOURCE_DIR/scripts/deploy-runtime.sh"

case "${1:-}" in
    '') dry_run=false ;;
    --dry-run) dry_run=true ;;
    *) echo "Usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
[[ "$DEST_DIR" = /* && "$DEST_DIR" != / && -d "$DEST_DIR" && ! -L "$DEST_DIR" ]] || {
    echo "Destination must be an existing absolute directory, not a symlink or /." >&2; exit 1;
}
DEST_DIR=$(realpath -- "$DEST_DIR")
BACKUP_ROOT=$(realpath -m -- "$BACKUP_ROOT")
[[ "$DEST_DIR" != "$SOURCE_DIR" ]] || { echo "Checkout and production must be separate directories." >&2; exit 1; }
[[ "$BACKUP_ROOT" != "$DEST_DIR" && "$BACKUP_ROOT" != "$DEST_DIR/"* ]] || {
    echo "Backups must be outside the deployment directory." >&2; exit 1;
}
# Lock held by this shell; closed automatically on exit. Use a protected directory
# so another user cannot redirect the lock through a symlink.
sudo -v
sudo install -d -m 700 "$BACKUP_ROOT"
sudo touch "$BACKUP_ROOT/deploy.lock"
# Keep flock running until this shell closes its pipe on exit.
coproc DEPLOY_LOCK { sudo -n flock -n "$BACKUP_ROOT/deploy.lock" bash -c 'echo locked; cat'; }
exec {lock_input}>&"${DEPLOY_LOCK[1]}"
read -r locked <&"${DEPLOY_LOCK[0]}" || { echo "Another deployment holds the lock." >&2; exit 1; }

cd "$SOURCE_DIR"
if "$dry_run"; then
    [[ -f build/index.html ]] || { echo "Run npm run build first." >&2; exit 1; }
    sync_runtime "$SOURCE_DIR" "$DEST_DIR" --without-dependencies --dry-run --itemize-changes
    exit 0
fi

stage=''
backup=''
stopped=false
changed=false
complete=false
cleanup() {
    local result=$?
    trap - EXIT INT TERM
    if ! "$complete" && "$stopped"; then
        if "$changed"; then
            echo "Deployment failed. Restoring previous application; live data is retained." >&2
            sudo systemctl stop "$SERVICE_NAME" || true
            if ! sync_runtime "$backup" "$DEST_DIR"; then
                echo "Rollback failed. Service remains stopped. Backup: $backup" >&2
                result=1
            else
                sudo systemctl start "$SERVICE_NAME" || result=1
            fi
        else
            sudo systemctl start "$SERVICE_NAME" || result=1
        fi
    fi
    if [[ -n "$stage" ]]; then sudo rm -rf -- "$stage"; fi
    if ! "$complete"; then echo "Deployment did not complete. Backup: ${backup:-not yet created}" >&2; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Installing locked dependencies and building before stopping production..."
npm ci
npm run build
[[ -s build/index.html && -s build/sw.js ]] || { echo "Incomplete frontend build." >&2; exit 1; }

stage=$(sudo mktemp -d /opt/lists-deploy-stage.XXXXXX)
sudo chown "$SERVICE_USER:" "$stage"
# Checkout credentials/data never enter staging.
sync_runtime "$SOURCE_DIR" "$stage" --without-dependencies
sudo -u "$SERVICE_USER" npm ci --prefix "$stage" --omit=dev --ignore-scripts
sudo -u "$SERVICE_USER" npm rebuild --prefix "$stage" better-sqlite3
sudo -u "$SERVICE_USER" node -e 'const D=require(process.argv[1]+"/node_modules/better-sqlite3"); const db=new D(":memory:"); db.close()' "$stage"

sudo systemctl is-active --quiet "$SERVICE_NAME" || { echo "Service must be running before deployment." >&2; exit 1; }
echo "Stopping service for a consistent application and data backup..."
stopped=true
sudo systemctl stop "$SERVICE_NAME"
backup=$(sudo mktemp -d "$BACKUP_ROOT/deploy-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
# The stopped service makes Yjs/SQLite copies consistent. Include sidecars,
# credentials, TLS, environment files and the old application/dependencies.
backup_entries=(build server node_modules package.json package-lock.json)
while IFS= read -r -d '' env_file; do backup_entries+=("${env_file##*/}"); done < <(sudo find "$DEST_DIR" -maxdepth 1 -type f -name '.env*' -print0)
sudo cp -a -- "${backup_entries[@]/#/$DEST_DIR/}" "$backup/"
printf 'Backup: %s\n' "$backup"

changed=true
sync_runtime "$stage" "$DEST_DIR"
sudo systemctl start "$SERVICE_NAME"
echo "Checking service, frontend and authentication endpoint..."
healthy=false
for attempt in {1..20}; do
    if sudo systemctl is-active --quiet "$SERVICE_NAME" &&
        sudo curl --insecure --silent --show-error --fail --max-time 3 "$HEALTH_URL/" -o "$stage/served.html" &&
        sudo cmp --silent "$DEST_DIR/build/index.html" "$stage/served.html" &&
        [[ "$(sudo curl --insecure --silent --show-error --max-time 3 -o "$stage/session.json" -w '%{http_code}' "$HEALTH_URL/api/session")" = 401 ]] &&
        sudo node -e 'const fs=require("fs"); if(JSON.parse(fs.readFileSync(process.argv[1])).error!=="Invalid session")process.exit(1)' "$stage/session.json"; then
        healthy=true; break
    fi
    sleep 1
done
"$healthy" || { sudo journalctl -u "$SERVICE_NAME" -n 30 --no-pager; exit 1; }
complete=true
echo "Deployment verified. Backup retained at $backup"
