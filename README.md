Good notes todos app for use with iOS Safari web browser, chrome for windows, chrome for linux, etc.
Can be installed as a PWA or just used on the web.

Uses completely local database for accessing all notes and todos, so is quite quick. Syncing using YJS.

Recommended for personal todos and quick notes on the go for across desktop or laptop computer, or with an iOS or android phone. But not for detailed note taking. For that, I recommend to use in conjunction with dokuwiki.

## Validation

- `npm test` runs isolated server, shared-data, and component lifecycle regression tests.
- `npm run check` checks Svelte and TypeScript diagnostics.
- `npm run build` builds the production SPA/PWA.

See [bug-fix and upgrade notes](docs/bug-fixes.md) before deploying the authentication and shared-data changes.

See [safe deployment instructions](docs/deployment.md) for backups, dry runs and rollback.

See [task integration API](docs/task-api.md) for authenticated server-to-server
task imports, shared clipboard matching, list-scoped tokens, and retry behavior.

## Nearby errands

Tag todos with `#supermarket`, `#coles`, `#woolworths` or `#kmart`, then open 🚗 from the home header. The bundled Melbourne catalogue is editable JSON; personal locations sync across devices. See [nearby errands and catalogue instructions](docs/nearby-errands.md).

The nearby catalogue includes 4,768 Melbourne locations across the existing brands, including shopping-centre businesses and hardware chains. The [per-brand coverage report](docs/retail-chain-coverage.json) records sources and remaining gaps. Tag a list or item with `#pcparts`, `#muji`, `#daiso`, `#hardware`, `#bunnings`, `#mitre10`, `#northland`, `#emporium` or a listed brand; use the screen's hashtag search to discover supported brands.
