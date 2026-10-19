Good notes todos app for use with iOS Safari web browser, chrome for windows, chrome for linux, etc.
Can be installed as a PWA or just used on the web.

Uses completely local database for accessing all notes and todos, so is quite quick. Syncing using YJS.

Recommended for personal todos and quick notes on the go for across desktop or laptop computer, or with an iOS or android phone. But not for detailed note taking. For that, I recommend to use in conjunction with dokuwiki.

The terminal client's `tui.config.json` is a localhost example. Keep personal
server settings in `tui.config.real.json`, which is ignored by Git.

## Toolchain

Use Node.js 24 LTS (24.15.0 or newer in the 24.x line) and npm/npx 12.2.0.
The npm version is recorded in `package.json`'s `packageManager` field.

```sh
npm install --global npm@12.2.0
npm --version
npx --version
npm ci
```

Make sure the npm installation's bin directory is on `PATH`; both version
commands should report `12.2.0`. In an existing Bash terminal, `hash -r` clears
cached command paths after upgrading.

TypeScript 7.0.2 supplies `npx tsc` and the diagnostics used by `npm run check`
and `npm run check:watch`. It is installed as the `@typescript/native` npm alias.
The `typescript` dependency aliases Microsoft's `@typescript/typescript6`
compatibility package because SvelteKit and Svelte's component transformation
still need the TypeScript 6 compiler API. `svelte-check` uses `--tsgo` to run the
TypeScript 7 compiler. See the [Svelte checker setup](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)
and [Microsoft's compatibility setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).

npm 12 requires explicit permission for dependency install scripts. The
`allowScripts` entries in `package.json` cover the locked versions of
`better-sqlite3`, `esbuild` and `leveldown` so clean installs can build their
native components. After changing one of those versions, review its install
script and update the entry with `npm install-scripts approve <package>`.

## Validation

- `npm test` runs isolated server, shared-data, and component lifecycle regression tests.
- `npm run check` checks Svelte and TypeScript diagnostics.
- `npm run build` builds the production SPA/PWA.

See [bug-fix and upgrade notes](docs/bug-fixes.md) before deploying the authentication and shared-data changes.

See [safe deployment instructions](docs/deployment.md) for backups, dry runs and rollback.

For downloadable app data, see [JSON backup coverage and restore behaviour](docs/json-backups.md).

See [task integration API](docs/task-api.md) for authenticated server-to-server
task imports, shared clipboard matching, list-scoped tokens, and retry behavior.

## Nearby errands

Tag todos with `#supermarket`, `#coles`, `#woolworths`, `#kmart` or `#bigw`, then open 🚗 from the home header. The bundled Melbourne catalogue is editable JSON; personal locations sync across devices. See [nearby errands and catalogue instructions](docs/nearby-errands.md).

The nearby catalogue includes 4,768 Melbourne locations across the existing brands, including shopping-centre businesses and hardware chains. The [per-brand coverage report](docs/retail-chain-coverage.json) records sources and remaining gaps. Tag a list or item with `#pcparts`, `#muji`, `#daiso`, `#hardware`, `#bunnings`, `#mitre10`, `#northland`, `#emporium` or a listed brand; use the screen's hashtag search to discover supported brands.
