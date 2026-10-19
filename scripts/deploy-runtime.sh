#!/usr/bin/env bash
# Shared with deployment regression tests. Never sync a whole checkout.
RUNTIME_SHARED_MODULES=(folderDefaultItems.ts syncProtocol.ts)

validate_runtime() {
    local runtime=$1
    # Resolve from staging rather than the caller's potentially private checkout.
    sudo -u "$SERVICE_USER" node -e 'const req=require("node:module").createRequire(process.argv[1]+"/package.json"); const D=req("better-sqlite3"); const db=new D(":memory:"); db.close()' "$runtime"
}

sync_runtime() {
    local source=$1 destination=$2
    shift 2
    local with_dependencies=true
    if [[ "${1:-}" = --without-dependencies ]]; then with_dependencies=false; shift; fi
    local directory
    for directory in build server node_modules src src/lib; do
        [[ ! -L "$destination/$directory" ]] || { echo "Refusing symlink: $destination/$directory" >&2; return 1; }
    done
    # Preview must not create directories or change their permissions.
    if [[ " $* " != *' --dry-run '* ]]; then
        sudo install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" "$destination/build" "$destination/server" || return
    fi
    # Retain old hashed assets for already-open clients.
    sudo rsync -ac --chown="$SERVICE_USER:" "$@" "$source/build/" "$destination/build/" || return
    # Everything except source/config is protected, including data and secrets.
    sudo rsync -ac --chown="$SERVICE_USER:" "$@" --include='/*.ts' --include='/tsconfig.json' --exclude='*' "$source/server/" "$destination/server/" || return
    # Copy only the modules shared by the API and frontend. Older backups may
    # lack some or all of them; their server does not import the missing files.
    local module
    local shared_includes=(--include='/lib/')
    for module in "${RUNTIME_SHARED_MODULES[@]}"; do
        if sudo test -f "$source/src/lib/$module"; then
            shared_includes+=(--include="/lib/$module")
        fi
    done
    if (( ${#shared_includes[@]} > 1 )); then
        if [[ " $* " != *' --dry-run '* ]]; then
            sudo install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" "$destination/src/lib" || return
        fi
        sudo rsync -ac --chown="$SERVICE_USER:" "$@" "${shared_includes[@]}" --exclude='*' "$source/src/" "$destination/src/" || return
    fi
    sudo rsync -ac --chown="$SERVICE_USER:" "$@" "$source/package.json" "$source/package-lock.json" "$destination/" || return
    if "$with_dependencies"; then
        sudo test -d "$source/node_modules" || { echo "Missing prepared dependencies." >&2; return 1; }
        if [[ " $* " != *' --dry-run '* ]]; then
            sudo install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" "$destination/node_modules" || return
        fi
        sudo rsync -ac --delete --chown="$SERVICE_USER:" "$@" "$source/node_modules/" "$destination/node_modules/" || return
    fi
}
