#!/usr/bin/env bash
set -Eeuo pipefail

# nuc_deploy.sh - Wrapper script for deploying on nucbox3 with required environment settings.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export APP_BASE_PATH="${APP_BASE_PATH:-/lists_and_prices}"
export LISTS_HEALTH_URL="${LISTS_HEALTH_URL:-http://127.0.0.1:3101}"

exec ./deploy.sh "$@"
