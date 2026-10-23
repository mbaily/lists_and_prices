#!/bin/bash
set -euo pipefail

client_checkout=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Use Node 24 or newer to run the local client."); process.exit(1); }'

if [[ ! -f "$client_checkout/node_modules/tsx/package.json" || ! -f "$client_checkout/node_modules/better-sqlite3/package.json" ]]; then
  (cd -- "$client_checkout" && npm ci)
fi

client_needs_frontend=true
for client_arg in "$@"; do
  case "$client_arg" in
    --no-serve|--help|--export-yjs|--build-dir|--build-dir=*) client_needs_frontend=false ;;
  esac
done
if [[ "$client_needs_frontend" == true && ! -f "$client_checkout/build/index.html" ]]; then
  (cd -- "$client_checkout" && APP_BASE_PATH= npm run build)
fi

# Generate machine-specific paths locally, keeping runtime files in the caller's pwd.
node "$client_checkout/scripts/build-local-client.mjs" --output ./lists-local-client
exec ./lists-local-client \
  --server https://git23069.hopto.org:9443/lists_and_prices \
  --username mb \
  --port 8083 \
  --insecure \
  "$@"
