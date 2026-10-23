# Foreground Linux client

The local client is a headless Yjs replica with optional frontend hosting. It runs
in the foreground; no background service or system installation is created.
The existing upstream server needs no configuration change.

Use this checkout's Node 24 toolchain and install dependencies with `npm ci`.
Build the frontend and create the executable launcher:

```sh
npm run build
npm run build:local
./lists-local-client --server https://your-server.example --username your-name
```

The password prompt signs in upstream once and records a bcrypt hash for local
browser login. The plaintext password is not saved. Open `http://127.0.0.1:8081`
and sign in with that username and password. Subsequent launches use the saved
account and upstream session:

```sh
./lists-local-client
```

Stop with Ctrl-C. Run `./lists-local-client --help` for all options.
`npm run local -- ...` also runs directly from source in this checkout.

For an upstream server with an untrusted or self-signed certificate, add
`--insecure` to skip certificate verification for upstream HTTPS and WebSocket
connections, including login and HTTP sync:

```sh
./lists-local-client --server https://git23069.hopto.org:9443/lists_and_prices \
  --username mb --insecure
```

Supply `--insecure` on subsequent runs too; it is not saved in the data directory.
Certificate verification remains enabled by default. The flag does not change
TLS verification for other requests or how browsers trust the local frontend.

## Current directory and generated files

The default data directory is **`./lists-local-data/` relative to the working
directory of the running client**, not relative to the source checkout or
executable. It is created automatically. There is one upstream account/server per
data directory. A second running client cannot open the same directory.

```sh
./lists-local-client --data-dir ./my-local-copy
```

You can launch the executable by its absolute path from another directory; its
storage will still be created in that working directory. Relative certificate,
password-file and build-directory paths also use that working directory.

The launcher defaults to `./lists-local-client` when built in this checkout. To
create it elsewhere, run the generator from the desired working directory, or
give an explicit output path:

```sh
node /path/to/checkout/scripts/build-local-client.mjs --output ./lists-local-client
```

This first version produces an executable **launcher**, not a standalone native
binary. It uses the Node executable, source checkout and installed dependencies
present when generated; keep those in place and regenerate after moving them.
The frontend defaults to that checkout's `build/`, or can be supplied with
`--build-dir`. It must be built for `/`, with `APP_BASE_PATH` unset.

The default executable and data-directory names are ignored by Git. Every new
data directory also contains an ignore-all `.gitignore`, including directories
with custom names. Source, tests and documentation belong in Git. If you choose
a different executable filename inside a Git checkout, add that filename to its
ignore rules yourself. Nothing is automatically committed.

## Storage and copying

| File | Contents |
| --- | --- |
| `yjs.sqlite` | Original binary Yjs updates, account configuration, local sessions, upstream session cookie and local password hash |
| `document.yjs` | An atomically replaced binary Yjs snapshot, with document identities and saved history retained |
| `.gitignore` | Keeps generated storage out of Git |

SQLite transactions commit local updates before the client acknowledges them.
Compaction merges original update bytes; it retains deletions, historical structs
and updates whose dependencies have not yet arrived. Snapshot refreshes run after
upstream exchange attempts and on clean shutdown. They can lag the database by
the request timeout plus configured interval. Once upstream sign-in is required,
snapshots continue refreshing at the configured interval.

**Stop the client before copying the entire data directory.** SQLite may also
have a journal file while running; retain it with the database after an unexpected
shutdown. You can copy `document.yjs` while running because it is replaced
atomically. It is binary data, not a text file to edit manually.

To move the complete local client state, stop it, copy its entire data directory,
then launch with `--data-dir` pointing to the copy. Local browser storage belongs
to its browser origin; changing hostname or port requires another local login.
Reopening a copied replica generates a fresh Yjs client identity for new edits.
Reconnecting an older copy merges it with upstream; it does not roll back the
upstream server. Directory copies are private data: `yjs.sqlite` includes session
credentials. New runtime files are private to the OS user. The standalone
`document.yjs` snapshot contains document data, without the authentication tables;
the current CLI resumes complete data directories, not standalone snapshot files.

## Offline and upstream login

The first run needs a successful upstream sign-in. Later runs can start offline.
Browsers connect to the laptop's independent authentication, sync API and Yjs
WebSocket endpoint, so local access works without upstream. Upstream WebSockets
exchange edits promptly, and periodic HTTP exchanges confirm server storage.
Pending state includes deletion-only edits.

After the upstream session expires or is revoked, stop and restart with:

```sh
./lists-local-client --login
```

This refreshes the upstream session and the local password hash. Local browser
sessions are independent of upstream revocation. Changing the local password hash
invalidates existing local sessions. All document data is retained.

For noninteractive use, `--password-file /path/to/private-password` reads a password
instead of prompting; a final newline is removed. Keep that file private and
remove it yourself when no longer needed. Subsequent launches need no password
file. Passwords are not accepted in command-line arguments.

Settings → Offline & sync distinguishes laptop confirmation from upstream
confirmation. A browser's successful sync confirms storage on the laptop; the
laptop may still have work waiting for upstream confirmation. The authenticated
`/api/local/status` endpoint also reports that upstream state.

## LAN and Wi-Fi

The default listener accepts only loopback connections. To listen on the LAN:

```sh
./lists-local-client --host 0.0.0.0 --port 8081 \
  --cert ./laptop-cert.pem --key ./laptop-key.pem
```

Use an HTTPS certificate trusted by the connecting devices and valid for the
hostname/IP they open. Allow the chosen port through the laptop firewall. Wi-Fi
client isolation or a guest network may prevent devices reaching the laptop.

Plain HTTP on loopback is sufficient for the laptop browser. Plain HTTP on a LAN
IP does not support the full frontend: UUID creation, service workers, clipboard
and geolocation depend on browser secure-context rules. The client does not
create or install certificates automatically.

The laptop must remain powered on and reachable for LAN devices to use it. Their
own browser caches remain separate. Devices opening the upstream address directly
continue to sync directly with upstream.

For replication without any frontend listener:

```sh
./lists-local-client --no-serve
```

The task integration API is not exposed by this local host. First-version
packaging does not include a bundled Node runtime, automatic updates, system
installation, or background-service management.

## Verification

`tests/local-client.test.ts` uses temporary storage and isolated servers. It covers
browser WebSocket replication, durable HTTP confirmation, offline writes and
restart, upstream restart and concurrent changes, deletion propagation,
upstream revocation without losing local login, snapshot/history preservation,
pending dependencies, writer exclusion and launching from an arbitrary directory.
No production account or storage is used. Test trusted HTTPS and access from
your actual LAN devices separately.

A production-build Chrome smoke check also verified local login, document load,
live WebSocket updates and the separate laptop/upstream confirmation display.
