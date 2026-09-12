// @ts-nocheck -- Isolated module loader for testing compiled Svelte runes.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';

const require = createRequire(import.meta.url);
export const Y = require('yjs');
export const root = fileURLToPath(new URL('../../', import.meta.url));

export function transpile(source, module = ts.ModuleKind.CommonJS) {
	return ts.transpileModule(source, { compilerOptions: { module, target: ts.ScriptTarget.ES2022 } }).outputText;
}

export class Provider {
	handlers = new Map();
	synced = false;
	on(event, handler) { const list = this.handlers.get(event) ?? []; list.push(handler); this.handlers.set(event, list); }
	emit(event, value) { for (const handler of this.handlers.get(event) ?? []) handler(value); }
	destroy() { this.destroyed = true; }
	disconnect() {}
	connect() {}
}

/** Real source, Svelte compiler and Yjs; only browser/network persistence is
 * replaced. A private module cache gives each fixture an independent client. */
export function createApp(options = {}) {
	const cache = new Map();
	const storage = new Map(options.username ? [['pnl_user', options.username]] : []);
	const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
	function load(file) {
		const absolute = path.resolve(root, file);
		if (cache.has(absolute)) return cache.get(absolute).exports;
		const module = { exports: {} };
		cache.set(absolute, module);
		let code = readFileSync(absolute, 'utf8');
		if (absolute.endsWith('.svelte.ts')) {
			code = compileModule(transpile(code, ts.ModuleKind.ESNext), { filename: absolute, generate: 'client' }).js.code;
		}
		const localRequire = (specifier) => {
			if (specifier === 'y-indexeddb') return { IndexeddbPersistence: Provider };
			if (specifier === 'y-websocket') return { WebsocketProvider: Provider };
			if (specifier.startsWith('.')) {
				const target = path.resolve(path.dirname(absolute), specifier);
				const resolved = [target, target + '.ts', target + '.js'].find(existsSync);
				if (!resolved) throw new Error(`Cannot resolve ${specifier} in ${file}`);
				return load(resolved);
			}
			return require(specifier);
		};
		new Function('require', 'module', 'exports', 'console', 'localStorage', 'navigator', 'fetch', transpile(code))(
			localRequire, module, module.exports, { ...console, log() {} }, localStorage,
			options.navigator ?? { onLine: true }, options.fetch ?? (() => { throw new Error('Unexpected network access in test'); })
		);
		return module.exports;
	}
	const store = load('src/lib/yjsStore.svelte.ts');
	const doc = store.initYjs('test-only', 'ws://unused');
	return {
		store, doc, load,
		data: load('src/lib/data.ts'), reports: load('src/lib/smartFolders.svelte.ts'),
		notes: load('src/lib/noteText.ts'), editing: load('src/lib/noteEditing.ts'),
		hierarchy: load('src/lib/hierarchy.ts'),
		dispose() { store.destroyYjs(); }
	};
}

export function merge(a, b) {
	const fromA = Y.encodeStateAsUpdate(a);
	const fromB = Y.encodeStateAsUpdate(b);
	Y.applyUpdate(a, fromB, 'peer');
	Y.applyUpdate(b, fromA, 'peer');
}

export function componentFunctions(file, names) {
	const text = readFileSync(path.join(root, file), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
	const ast = ts.createSourceFile(file + '.ts', text, ts.ScriptTarget.Latest, true);
	return ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)).map((statement) => statement.getText(ast)).join('\n');
}