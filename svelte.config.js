import adapter from '@sveltejs/adapter-static';
import { relative, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { appBasePath } from './scripts/app-base-path.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// defaults to rune mode for the project, except for `node_modules`. Can be removed in svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		paths: { base: appBasePath() },
		version: { name: version }
	}
};

export default config;
