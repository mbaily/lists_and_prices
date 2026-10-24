#!/usr/bin/env bash
set -Eeuo pipefail

# Discover the running service's actual paths before stopping it. Credentials
# remain in the deployment; snapshots contain only SQLite, Yjs and task tokens.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME=lists-and-prices.service
SERVER_DIR=/opt/lists_and_prices/server
OUTPUT=${1:-}
[[ -n "$OUTPUT" ]] || { echo "Usage: bash backup.sh /absolute/new-backup-dir [--offline] [--service NAME] [--server-dir DIR]" >&2; exit 2; }
shift
[[ "$OUTPUT" = /* && ! -e "$OUTPUT" && ! -L "$OUTPUT" ]] || { echo "Backup destination must be an absolute, new directory" >&2; exit 2; }
offline=false
while (( $# )); do
    case "$1" in
        --offline) offline=true; shift ;;
        --service|--server-dir)
            (( $# >= 2 )) || { echo "Missing value for $1" >&2; exit 2; }
            if [[ "$1" = --service ]]; then SERVICE_NAME=$2; else SERVER_DIR=$2; fi
            shift 2 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done
if "$offline"; then
    exec node "$SCRIPT_DIR/scripts/backup-user-data.mjs" --server-dir "$SERVER_DIR" --output "$OUTPUT"
fi
temporary=$(mktemp -d)
stopped=false
cleanup() {
    local result=$?
    trap - EXIT INT TERM
    if "$stopped"; then sudo systemctl start "$SERVICE_NAME" || result=1; fi
    rm -rf -- "$temporary"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
sudo node "$SCRIPT_DIR/scripts/backup-user-data.mjs" --capture-service "$SERVICE_NAME" --server-dir "$SERVER_DIR" --output "$temporary/paths.json"
stopped=true
sudo systemctl stop "$SERVICE_NAME"
sudo node "$SCRIPT_DIR/scripts/backup-user-data.mjs" --manifest "$temporary/paths.json" --output "$OUTPUT"
