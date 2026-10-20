import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { readFileSync } from 'node:fs';
import { VERSION as SVELTE_VERSION } from 'svelte/compiler';
import { appBasePath } from './scripts/app-base-path.mjs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const basePath = appBasePath();
const publicRoot = `${basePath}/`;
const apiPattern = new RegExp(`^https?://[^/]+${basePath}/api(?:/|$)`);

export default defineConfig(({ command }) => ({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__SVELTE_VERSION__: JSON.stringify(SVELTE_VERSION),
		__YJS_VERSION__: JSON.stringify(pkg.dependencies.yjs.replace(/[\^~]/g, ''))
	},
	server: {
		proxy: {
			[`${basePath}/api`]: {
				target: 'https://127.0.0.1:8080',
				secure: false,
				rewrite: path => path.slice(basePath.length)
			},
			[`${basePath}/yjs`]: {
				target: 'wss://127.0.0.1:8080',
				ws: true,
				secure: false,
				rewrite: path => path.slice(basePath.length)
			}
		}
	},
	plugins: [
		sveltekit(),
		{
			name: 'lists-deployment-config',
			apply: 'build',
			generateBundle() {
				// Keep the server's external cookie path in sync with this exact build.
				this.emitFile({ type: 'asset', fileName: 'deployment.json', source: JSON.stringify({ basePath }) + '\n' });
			}
		},
		SvelteKitPWA({
			base: publicRoot,
			scope: publicRoot,
			registerType: 'autoUpdate',
			// Register from the layout so SvelteKit uses the correct dev/build worker URL.
			injectRegister: false,
			devOptions: { enabled: true },
			manifest: {
				name: 'Lists & Prices',
				short_name: 'Lists',
				description: 'Offline-first list and price tracker',
				theme_color: '#ffffff',
				background_color: '#ffffff',
				display: 'standalone',
				orientation: 'portrait',
				id: publicRoot,
				scope: publicRoot,
				start_url: publicRoot,
				icons: [
					// PNG icons required by iOS Safari (SVG icons are ignored for home-screen).
					{ src: `${publicRoot}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: `${publicRoot}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
					{ src: `${publicRoot}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					// SVG kept as fallback for modern browsers
					{ src: `${publicRoot}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
				]
			},
			workbox: {
				// The offline retail/suburb catalogues make the main app chunk exceed 2 MiB.
				maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
				// Precache handled automatically by SvelteKitPWA plugin
				// Force cache the root HTML so iOS can launch from homescreen offline.
				additionalManifestEntries: [
					{ url: 'index.html', revision: Date.now().toString() }
				],
				// Immediately activate new SW without waiting for old tabs to close.
				skipWaiting: true,
				clientsClaim: true,
				navigateFallback: command === 'serve' ? undefined : 'index.html',
				navigateFallbackDenylist: [new RegExp(`^${basePath}/(?:api|yjs)(?:/|$)`)],
				// Don't let the SW intercept non-GET API calls — let them go to network.
				runtimeCaching: [
					{
						urlPattern: apiPattern,
						handler: 'NetworkOnly'
					},
					{
						urlPattern: /^wss?:\/\//,
						handler: 'NetworkOnly'
					}
				]
			}
		})
	]
}));
