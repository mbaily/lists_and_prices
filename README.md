# Lists & Prices

A fast, offline-first personal notes, todos, and errand tracker designed for mobile and desktop.
Built with **Svelte 5** and **Yjs**, it runs as an installable Progressive Web App (PWA) with instant local storage and seamless multi-device synchronization.

## Key Features

- **Offline-First & Instant:** Reads and writes to local storage (IndexedDB in the browser, SQLite on the backend), ensuring sub-millisecond response times even completely offline.
- **Real-Time Sync:** Peer-to-peer and server synchronization powered by Yjs over WebSockets with offline conflict resolution.
- **Installable PWA:** Designed for iOS Safari, Chrome on Android, Windows, macOS, and Linux. Add to your home screen or install as a desktop app.
- **Nearby Errands:** Location-aware errand checklist that automatically groups tasks by proximity to supermarkets, hardware stores, shopping centres, or custom-tagged places.
- **Pricing & Quantities:** Track item prices, quantities, and totals directly in your shopping lists.
- **Self-Hostable & Private:** Single Node.js server with built-in authentication, secure session management, and encrypted backup support.
- **Extensible:** Embed live bills and calendar events from Simple Todo via inline widgets (`[[bills:upcoming]]`, `[[calendar:today]]`).

---

## Quick Start

### Prerequisites
- **Node.js 24 LTS** (24.15.0 or newer)
- **npm 12.2.0** (or install via `npm install --global npm@12.2.0`)

### Installation & Launch

1. **Clone repository and install locked dependencies:**
   ```sh
   git clone https://github.com/mbaily/lists_and_prices.git
   cd lists_and_prices
   npm ci
   ```

2. **Create your first user account:**
   ```sh
   npm start -- --add-user
   # Prompts for username and password
   ```

3. **Build and start the production server:**
   ```sh
   npm run build
   npm start
   ```
   Open `http://localhost:8080` in your browser and sign in.

### Development Mode
To run the Vite development server with hot-reloading:
```sh
npm run dev
```

---

## Navigation & Browse View

On any list, use the **Browse view** button (next to the three-dot menu) to hide the summary, pinned items, and favourites while keeping the breadcrumb and input bar visible. Selection controls remain accessible in browse view.

- **Pinned items:** Scroll sideways at the top of the list.
- **Favourites:** Wrap across rows and scroll away naturally as you scroll down.
- **Quick navigation:** In browse view, the arrows beside the input bar step through your favourite lists in order, skipping folders and wrapping at either end. The button indicates your current position among all favourites.

---

## Toolchain & Dependencies

Use Node.js 24 LTS and npm 12.2.0 (recorded in `package.json`'s `packageManager` field).

```sh
npm install --global npm@12.2.0
npm --version
npx --version
npm ci
```

Make sure the npm installation's bin directory is on `PATH`; both version commands should report `12.2.0`. In an existing Bash terminal, `hash -r` clears cached command paths after upgrading.

TypeScript 7.0.2 supplies `npx tsc` and diagnostics used by `npm run check`. SvelteKit component compilation uses Microsoft's `@typescript/typescript6` compatibility alias.

npm 12 requires explicit permission for dependency install scripts. The `allowScripts` entries in `package.json` approve `better-sqlite3`, `esbuild` and `leveldown` for native compilation.

---

## Nearby Errands

Tag todos with hashtags such as `#supermarket`, `#coles`, `#woolworths`, `#kmart` or `#bigw`, then tap 🚗 in the home header.

- Bundled with a verified retail catalogue covering 4,768 Melbourne locations across major chains, shopping centres, and hardware stores.
- Custom places and tags can be saved and sync automatically across devices.
- Discover supported brands and hashtags using the in-app hashtag search.
- For catalogue details and custom datasets, see the [Nearby Errands Guide](docs/nearby-errands.md) and [Coverage Report](docs/retail-chain-coverage.json).

---

## Documentation & Guides

- [**Deployment Guide**](docs/deployment.md): Safe deployments, atomic file sync, health checks, and automatic rollback.
- [**HTTPS Reverse Proxy**](docs/reverse-proxy.md): Serving under subpaths (e.g. `/lists/` or `/lists_and_prices/`) with Caddy or Nginx.
- [**Server Storage & Backups**](docs/storage.md): External SQLite database, Y-LevelDB persistence, and token configuration.
- [**JSON Backups & Restore**](docs/json-backups.md): Comprehensive export and restore behavior for all lists, notes, and preferences.
- [**Foreground Local Client**](docs/local-client.md): Headless local Linux replica with optional local/LAN hosting.
- [**Task Integration API**](docs/task-api.md): Authenticated server-to-server task imports and list-scoped API tokens.
- [**Bug Fixes & Upgrade Notes**](docs/bug-fixes.md): Historical upgrade notes and bug resolutions.

---

## Testing & Validation

- `npm test`: Runs the test suite (460+ isolated regression tests covering data sync, auth, and component lifecycles).
- `npm run check`: Runs Svelte and TypeScript diagnostic checks.
- `npm run build`: Compiles the production SPA/PWA assets.

---

## License

Released under the [MIT License](LICENSE).
