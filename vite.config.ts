import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { readFileSync } from 'node:fs';
import { VERSION as SVELTE_VERSION } from 'svelte/compiler';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig(({ command }) => ({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__SVELTE_VERSION__: JSON.stringify(SVELTE_VERSION),
		__YJS_VERSION__: JSON.stringify(pkg.dependencies.yjs.replace(/[\^~]/g, ''))
	},
	server: {
		proxy: {
			'/api': {
				target: 'https://127.0.0.1:8080',
				secure: false
			},
			'/yjs': {
				target: 'wss://127.0.0.1:8080',
				ws: true,
				secure: false
			}
		}
	},
	plugins: [
		sveltekit(),
		SvelteKitPWA({
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
				// Relative paths so the installed PWA works regardless of host/port changes.
				scope: '/',
				start_url: '/',
				icons: [
					// PNG icons required by iOS Safari (SVG icons are ignored for home-screen).
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					// SVG kept as fallback for modern browsers
					{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
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
				// Don't let the SW intercept non-GET API calls — let them go to network.
				runtimeCaching: [
					{
						urlPattern: /^https?:\/\/[^/]+\/api\//,
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
