# Hosting at / or behind a subpath reverse proxy

The default build still runs at `/` on the app's own port. Existing certificates,
startup commands and browser storage continue to work with that configuration.

```sh
npm run build
./run.sh
```

To host at `https://your-host.ddns.net/lists/`, set the public prefix when building:

```sh
APP_BASE_PATH=/lists npm run build
```

Use `/lists`, without a trailing slash. Nested prefixes such as `/tools/lists`
also work. All browser API requests, WebSockets, links, static assets and PWA
URLs include this prefix. It is compiled into the frontend: changing the prefix
requires a rebuild. One build targets one public path; a `/lists` build is not
also a browser client for `/` on the backend port.

The proxy must strip the prefix for **every** request, including WebSocket upgrades:

```text
Browser: https://your-host.ddns.net/lists/api/session
Backend: http://127.0.0.1:8082/api/session

Browser: wss://your-host.ddns.net/lists/yjs/pnl-username
Backend: ws://127.0.0.1:8082/yjs/pnl-username
```

The backend still serves `/api`, `/yjs` and the SPA at its own root. Its strict
Yjs document names and existing stored data keep their current namespace.
`build/deployment.json` records the public prefix, so the backend automatically
scopes its cookie to `/lists/`. Deploy the entire build with the server.

## Backend settings for HTTPS termination

For a proxy on the same machine, set these in the service's environment:

```ini
LISTS_HOST=127.0.0.1
LISTS_TLS=off
SESSION_COOKIE_SECURE=true
```

`LISTS_TLS=off` makes Node use HTTP even when old `server/cert.pem` and
`server/key.pem` files exist. Those files can stay in place. With this option
unset or set to `auto`, Node retains its current certificate detection behavior.
`LISTS_HOST` is optional; omitting it retains the current listening behavior.

`SESSION_COOKIE_SECURE=true` keeps the browser session cookie HTTPS-only even
though the proxy-to-Node connection uses HTTP. When unset, its default follows
Node's own TLS mode as before. Forwarded headers do not override this explicit
policy; `trust proxy` is not required for the current application. Use a private
network interface instead of loopback if the proxy runs on a different machine.

`.env.example` documents these settings, but neither the server nor `deploy.sh`
loads `.env` automatically. For systemd, add `Environment=` entries in a service
override, reload systemd and restart the service when switching to the proxy.

## Caddy

Replace the hostname with your existing No-IP hostname. Add this to the Caddy
configuration alongside other apps' path handlers:

```caddyfile
your-host.ddns.net {
    redir /lists /lists/ 308

    handle_path /lists/* {
        reverse_proxy 127.0.0.1:8082
    }
}
```

`handle_path` strips `/lists`; `reverse_proxy` supports WebSocket upgrades
automatically. Caddy manages the public hostname's HTTPS certificate when its
normal automatic-HTTPS requirements are met. See the official
[path handling](https://caddyserver.com/docs/caddyfile/directives/handle_path),
[WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)
and [HTTPS](https://caddyserver.com/docs/automatic-https) documentation.

## NGINX

Put this `map` in NGINX's `http` context:

```nginx
map $http_upgrade $lists_connection_upgrade {
    default upgrade;
    ''      close;
}
```

Put the locations below inside your existing HTTPS `server` block. Keep your
hostname and public certificate configuration in that block:

```nginx
location = /lists {
    return 308 /lists/;
}

location /lists/ {
    # The trailing slash strips the matching /lists/ prefix.
    proxy_pass http://127.0.0.1:8082/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $lists_connection_upgrade;
    proxy_read_timeout 3600s;

    # Match the app's binary offline-sync request limit.
    client_max_body_size 64m;
}
```

The upgrade headers are needed for automatic Yjs synchronization. See NGINX's
[WebSocket documentation](https://nginx.org/en/docs/http/websocket.html) and
[proxy_pass URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

## Deployment and development

For the existing deployment script, keep the prefix in the build environment:

```sh
APP_BASE_PATH=/lists LISTS_HEALTH_URL=http://127.0.0.1:8082 ./deploy.sh
```

The script rebuilds the frontend, so setting `APP_BASE_PATH` only on an earlier
manual build is insufficient. Health checks still use the backend's root paths.
The service environment supplies the runtime TLS/cookie settings separately.
Follow the normal release-version and backup procedure in [deployment.md](deployment.md).

`APP_BASE_PATH=/lists npm run dev` also supports prefixed API/WebSocket requests.
The development proxy continues to target the existing HTTPS backend on port
8080; adjust its target in `vite.config.ts` if your development backend differs.

Both terminal clients accept an optional `"basePath": "/lists"` in their JSON
configuration, alongside `hostname`, `port`, `tls` and `insecure`. Use port 443,
`tls: true` and `insecure: false` for the public HTTPS proxy. Existing configs
without `basePath` retain root access. External task integrations should use
`https://your-host.ddns.net/lists/api/tasks/...`.

## Moving existing offline installations

Before switching, sync outstanding edits on every device and export a JSON
backup. Browser IndexedDB/localStorage belong to an origin (scheme, hostname and
port), not a path: changing from port 8082 to 443 creates a new storage origin.
The new installation downloads server data after sign-in; unsynchronized edits
in the old installation do not transfer automatically.

Install a new Home Screen shortcut from `/lists/` and verify offline launch,
editing and synchronization on the actual phone before retiring the old one.
If moving from `/` on the same origin, retire the old root service-worker
registration so it cannot handle sibling apps. Unregister that worker without
clearing IndexedDB or site data that may contain unsynchronized work. Login and
logout clear the old root session cookie when using a prefixed build.

Apps under different paths share the browser origin and storage permissions.
Use distinct storage keys in other apps, and treat apps sharing this hostname
as part of the same trust boundary.

For a smoke check, verify login/logout, automatic WebSocket sync, manual Sync
now, favourites and report links, reloading a nested report URL, PWA installation
and offline reload. Browser requests for this app should stay below `/lists/`.
