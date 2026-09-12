// @ts-nocheck -- Evaluate compiler output with a test-only module loader.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { transpile } from './app.mjs';

const require = createRequire(import.meta.url);
// Match createApp/evaluated modules: under `node --import tsx`, mixing ESM
// imports with require can create two Svelte runtimes (and effect_orphan).
const runtime = require('svelte/internal/client');
// Node resolves `svelte` to its server entry by default. Use the installed
// client entry for real onDestroy/onMount/untrack, sharing the internal runtime.
const svelteClient = require(path.join(path.dirname(require.resolve('svelte/package.json')), 'src/index-client.js'));
assert.equal(svelteClient.untrack, runtime.untrack, 'All client code must share the same Svelte runtime');

export function parseJavaScript(code, filename) {
	return ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function runtimeCall(node, name) {
	return node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
		ts.isIdentifier(node.expression.expression) && node.expression.expression.text === '$' &&
		node.expression.name.text === name;
}

function runtimeStatement(node, name) {
	return ts.isExpressionStatement(node) && runtimeCall(node.expression, name);
}

/**
 * Compile the ENTIRE original component, retaining template-driven rune
 * transformations and declaration order. Remove only the emitted render tail,
 * from the first template instantiation/$.comment()/$.init() through $.append,
 * keeping the compiler's $.push/$.pop and every script pre-effect intact.
 *
 * This deliberately depends on Svelte 5's emitted shape and fails loudly when
 * that shape changes. It is NOT a DOM mount, hydration or end-to-end test:
 * children/rendering are omitted, and post-mount effects never get a turn.
 */
export function compileInitializer(source, filename) {
	const { js } = compile(source, { filename, generate: 'client', dev: false });
	const ast = parseJavaScript(js.code, filename + '.js');
	const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) &&
		node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
	assert.ok(component?.body, `${filename}: expected a compiled default component function`);
	const statements = component.body.statements;
	assert.ok(runtimeStatement(statements[0], 'push'), `${filename}: expected component context push`);
	assert.ok(runtimeStatement(statements.at(-1), 'pop'), `${filename}: expected component context pop`);

	const templates = new Set(ast.statements.filter(ts.isVariableStatement).flatMap((statement) =>
		statement.declarationList.declarations.filter((declaration) =>
			runtimeCall(declaration.initializer, 'from_html') || runtimeCall(declaration.initializer, 'from_svg')
		).map((declaration) => declaration.name.getText(ast))
	));
	const renderStart = statements.find((statement) => runtimeStatement(statement, 'init') ||
		(ts.isVariableStatement(statement) && statement.declarationList.declarations.some(({ initializer }) =>
			runtimeCall(initializer, 'comment') || (initializer && ts.isCallExpression(initializer) &&
				ts.isIdentifier(initializer.expression) && templates.has(initializer.expression.text))
		))
	);
	assert.ok(renderStart, `${filename}: unrecognized render boundary; update the initialization probe`);
	const preEffects = statements.filter((statement) => runtimeStatement(statement, 'user_pre_effect'));
	assert.ok(preEffects.length > 0, `${filename}: expected actual compiled pre-effects`);
	assert.ok(preEffects.every((statement) => statement.end <= renderStart.getStart(ast)),
		`${filename}: stripping the render tail would discard a script pre-effect`);

	return js.code.slice(0, renderStart.getStart(ast)) + js.code.slice(statements.at(-1).getStart(ast));
}

/** Only child components and CSS are stubbed here; app modules use createApp's
 * isolated real Svelte/Yjs loader. Unknown imports fail rather than become no-ops. */
export function evaluateComponentModule(code, app, generate = 'client') {
	const imports = [];
	function localRequire(specifier) {
		imports.push(specifier);
		if (specifier === 'svelte') return generate === 'client' ? svelteClient : require('svelte');
		if (specifier.startsWith('svelte/')) return require(specifier);
		if (specifier.startsWith('$lib/')) {
			assert.ok(app, `An isolated app is required for ${specifier}`);
			return app.load(path.join('src/lib', specifier.slice('$lib/'.length)) + '.ts');
		}
		if (specifier.startsWith('./') && specifier.endsWith('.svelte')) {
			return { default() { assert.fail(`Unexpected child render: ${specifier}`); } };
		}
		if (specifier.endsWith('.css')) return {};
		if (specifier === 'y-quill') return require(specifier);
		assert.fail(`Unexpected import during component initialization: ${specifier}`);
	}
	const module = { exports: {} };
	// Lexically hide browser storage/globals; do not install globals or use any
	// user data. ES2022 transpilation preserves let/const and therefore the TDZ.
	new Function('require', 'module', 'exports', '__APP_VERSION__',
		'window', 'document', 'localStorage', 'sessionStorage', 'fetch', transpile(code))(
		localRequire, module, module.exports, 'component-init-test',
		undefined, undefined, undefined, undefined,
		() => { assert.fail('Unexpected network access in component initialization'); }
	);
	assert.equal(typeof module.exports.default, 'function', 'Compiled component module must export a function');
	return { component: module.exports.default, imports };
}

/** Real user_pre_effect runs synchronously inside effect_root. Never replace
 * it (or untrack/derived/state) with a mock, and never wait for a microtask here. */
export function initializeCompiled(code, app, props = {}) {
	const { component } = evaluateComponentModule(code, app);
	let completed = false;
	const dispose = runtime.effect_root(() => {
		component(null, props);
		completed = true;
	});
	try {
		assert.equal(completed, true, 'The complete component script must initialize synchronously');
	} finally {
		// Destroy scheduled regular effects before they can touch an absent DOM.
		// If initialization throws, Svelte itself destroys the failed effect root.
		dispose();
	}
}