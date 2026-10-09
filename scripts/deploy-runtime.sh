#!/usr/bin/env bash
# Shared with deployment regression tests. Never sync a whole checkout.
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
    # The API and frontend share the default-item reader. Copy only that module.
    # Older backups have no shared module; their server does not import it.
    if sudo test -f "$source/src/lib/folderDefaultItems.ts"; then
        if [[ " $* " != *' --dry-run '* ]]; then
            sudo install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" "$destination/src/lib" || return
        fi
        sudo rsync -ac --chown="$SERVICE_USER:" "$@" --include='/lib/' --include='/lib/folderDefaultItems.ts' --exclude='*' "$source/src/" "$destination/src/" || return
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
