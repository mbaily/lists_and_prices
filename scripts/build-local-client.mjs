#!/usr/bin/env node
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { output: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
	console.log('node scripts/build-local-client.mjs [--output ./lists-local-client]\nCreates an executable launcher using this checkout and its installed Node runtime.');
} else {
	const output = path.resolve(values.output ?? 'lists-local-client');
	const marker = '# Generated Lists & Prices local client launcher';
	if (existsSync(output) && !readFileSync(output, 'utf8').includes(marker)) throw new Error(`Refusing to overwrite ${output}`);
	const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
	const require = createRequire(import.meta.url);
	const script = `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} --import ${quote(require.resolve('tsx'))} ${quote(fileURLToPath(new URL('../server/local-client.ts', import.meta.url)))} "$@"\n`;
	writeFileSync(output, script, { mode: 0o755 }); chmodSync(output, 0o755);
	console.log(`Created ${output}\nRequires this checkout and node_modules to remain in place. Runtime paths use the caller's current directory.`);
}
