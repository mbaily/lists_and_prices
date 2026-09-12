// @ts-nocheck -- Regression probes execute the actual Svelte compiler output.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { createApp, root, Y } from './helpers/app.mjs';
import { compileInitializer, evaluateComponentModule, initializeCompiled, parseJavaScript } from './helpers/component-init.mjs';

// These are script-initialization tests, NOT full DOM end-to-end tests. The
// helper removes the compiled render tail, but keeps Svelte's real synchronous
// pre-effects, declaration order, lazy derived values, and lifecycle registration.
const components = ['HomeScreen', 'ListScreen', 'SettingsScreen', 'FavouritesOrderScreen'];

for (const name of components) {
	for (const historical of [false, true]) {
		test(`${name} compiled client script initializes in ${historical ? 'historical' : 'live'} view without TDZ`, () => {
			const filename = path.join(root, 'src/lib/components', name + '.svelte');
			const code = compileInitializer(readFileSync(filename, 'utf8'), filename);
			const app = createApp();
			try {
				// Nonempty real data exercises derived reads and favourites traversal.
				// createApp replaces persistence/network providers, not Svelte or Yjs.
				const folder = app.data.createFolder('Fixture folder', null);
				const list = app.data.createList('Historical list', folder, 'plain');
				const item = app.data.createItem(list, 'Fixture task');
				app.data.updateFolder(folder, { favourite: true });
				app.data.updateList(list, { favourite: true, defaultIsNote: true });
				app.store.idbSynced.done = true;
				app.store.createCommit('Initialization fixture');
				const commitId = app.store.readCommits()[0].id;
				app.data.updateList(list, { name: 'Live list', defaultIsNote: false });
				app.data.updateItem(item, { checked: true });
				if (historical) app.store.viewCommit(commitId);

				assert.equal(app.store.commitState.isHistorical, historical);
				assert.equal(app.store.commitState.commitId, historical ? commitId : null);
				assert.equal(app.data.readLists()[0].name, historical ? 'Historical list' : 'Live list');
				const viewDoc = app.store.getDoc();
				assert.equal(viewDoc === app.doc, !historical, 'History must use an actual separate snapshot document');
				const liveBefore = Y.encodeStateAsUpdate(app.doc);
				const viewBefore = Y.encodeStateAsUpdate(viewDoc);
				const unexpectedCallback = () => assert.fail('Navigation/logout must not run during initialization');

				assert.doesNotThrow(() => initializeCompiled(code, app, {
					listId: list,
					orderedLists: app.data.readLists(),
					onBack: unexpectedCallback,
					onLogout: unexpectedCallback,
					onHome: unexpectedCallback,
					onOpenList: unexpectedCallback,
					onNavigateFolder: unexpectedCallback,
					onNavigateList: unexpectedCallback
				}));
				assert.deepEqual(Y.encodeStateAsUpdate(app.doc), liveBefore, 'Initialization must not mutate the live document');
				assert.deepEqual(Y.encodeStateAsUpdate(viewDoc), viewBefore, 'Initialization must not mutate the viewed document');
			} finally {
				app.dispose();
			}
		});
	}
}

// A passing app-only probe could accidentally hide the bug by dropping or
// deferring pre-effects. Standalone compiled .svelte controls prove otherwise,
// including dependencies reached indirectly via untrack/helpers and $derived.
for (const { name, setup, read } of [
	{ name: 'direct state read', setup: '', read: 'observe(lateState)' },
	{ name: 'untracked local helper', setup: 'function readState() { return lateState; }', read: 'untrack(() => observe(readState()))' },
	{ name: 'lazy derived dependency', setup: 'const mirrored = $derived(lateState);', read: 'observe(mirrored)' }
]) {
	test(`probe catches a pre-effect TDZ through ${name}, but accepts declaration-first order`, () => {
		const filename = path.join(root, 'tests/ComponentInitControl.svelte');
		const declaration = 'let lateState = $state(42);';
		const standalone = (effectFirst) => `<script>
			import { untrack } from 'svelte';
			let { observe } = $props();
			${effectFirst ? '' : declaration}
			${setup}
			$effect.pre(() => { ${read}; });
			${effectFirst ? declaration : ''}
		</script>
		<button onclick={() => lateState++}>{lateState}</button>`;
		const observed = [];
		const props = { observe: (value) => observed.push(value) };

		const broken = compileInitializer(standalone(true), filename);
		assert.throws(() => initializeCompiled(broken, undefined, props), {
			name: 'ReferenceError', message: /Cannot access 'lateState' before initialization/
		});
		assert.deepEqual(observed, []);

		const fixed = compileInitializer(standalone(false), filename);
		initializeCompiled(fixed, undefined, props);
		// No tick/flush/await: the callback must already have run exactly once.
		assert.deepEqual(observed, [42], 'Svelte pre-effects must execute synchronously, not be stubbed or deferred');
	});
}

test('FullScreenEditor SSR module import keeps browser-only Quill behind onMount', () => {
	const filename = path.join(root, 'src/lib/components/FullScreenEditor.svelte');
	const { js } = compile(readFileSync(filename, 'utf8'), { filename, generate: 'server', dev: false });
	const ast = parseJavaScript(js.code, filename + '.js');
	const isQuillJavaScript = (specifier) => /^quill(?:\/|$)/.test(specifier) && !specifier.endsWith('.css');
	const staticImports = ast.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
	assert.deepEqual(staticImports.filter(isQuillJavaScript), [], 'SSR must not eagerly import Quill JavaScript (CSS is safe)');

	let lazyQuillImports = 0;
	function visit(node, insideOnMount = false) {
		if (ts.isCallExpression(node)) {
			if (ts.isIdentifier(node.expression) && node.expression.text === 'onMount') insideOnMount = true;
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				ts.isStringLiteral(node.arguments[0]) && isQuillJavaScript(node.arguments[0].text)) {
				lazyQuillImports++;
				assert.equal(insideOnMount, true, 'Dynamic Quill import must remain inside the client-only onMount callback');
			}
		}
		ts.forEachChild(node, (child) => { visit(child, insideOnMount); });
	}
	visit(ast);
	assert.equal(lazyQuillImports, 1, 'Check the real lazy Quill import, not an accidentally empty SSR module');

	const app = createApp();
	try {
		// Evaluate the actual server-compiled module without window/document.
		// CSS/child components alone are stubbed; y-quill and Svelte are real.
		// This checks module import, not SSR rendering or Quill mounting.
		const { imports } = evaluateComponentModule(js.code, app, 'server');
		assert.deepEqual(imports.filter(isQuillJavaScript), []);
	} finally {
		app.dispose();
	}
});