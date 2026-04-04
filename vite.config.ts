import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Lists & Prices',
				short_name: 'Lists',
				description: 'Offline-first list and price tracker',
				theme_color: '#ffffff',
				background_color: '#ffffff',
				display: 'standalone',
				orientation: 'portrait',
				icons: [
					{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
			}
		})
	]
});

