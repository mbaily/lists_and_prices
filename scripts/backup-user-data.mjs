/** Consistent user-state snapshots. Credentials in .htpasswd are never copied. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths } from '../server/storage-paths.ts';

/** @typedef {import('../server/storage-paths.ts').StoragePaths} StoragePaths */

/** @param {string} service @param {string} serverDirectory @returns {StoragePaths} */
export function captureServiceStorage(service, serverDirectory) {
	const pid = execFileSync('systemctl', ['show', service, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
	if (!/^[1-9]\d*$/.test(pid)) throw new Error('Service must be running to discover its storage; use --offline for an already stopped service');
	const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`).toString().split('\0').filter(value => value.includes('='))
		.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
	return resolveStoragePaths(env, serverDirectory, fs.readlinkSync(`/proc/${pid}/cwd`));
}

/** @param {StoragePaths} storage @param {string} destination */
export async function backupUserData(storage, destination) {
	if (!path.isAbsolute(destination)) throw new Error('Backup destination must be absolute');
	if (!storage.yjsDirectory) throw new Error('Yjs persistence is disabled; set LISTS_DATA_DIR or YPERSISTENCE');
	for (const file of [storage.dbFile, storage.yjsDirectory]) {
		if (!fs.existsSync(file)) throw new Error(`User data does not exist: ${file}`);
	}
	const inside = path.relative(fs.realpathSync(storage.yjsDirectory), path.resolve(destination));
	if (!inside || (!inside.startsWith('..' + path.sep) && inside !== '..' && !path.isAbsolute(inside))) {
		throw new Error('Backup destination must be outside the Yjs directory');
	}
	// Opening LevelDB can rewrite CURRENT, logs and manifests, even for a lock
	// check. Run that open/close as the data owner so a root-run backup never
	// leaves new root-owned private files in a service-owned store.
	const require = createRequire(path.join(storage.serverDirectory, '../package.json'));
	const owner = fs.statSync(storage.yjsDirectory);
	const check = `
const {createRequire}=require('node:module');
const level=createRequire(process.argv[1])('leveldown')(process.argv[2]);
level.open({createIfMissing:false}, error => {
  if(error){process.stderr.write('LevelDB open failed\\n');process.exitCode=1;return;}
  level.close(error => {if(error){process.stderr.write('LevelDB close failed\\n');process.exitCode=1;}});
});`;
	try {
		execFileSync(process.execPath, ['-e', check, path.join(storage.serverDirectory, '../package.json'), storage.yjsDirectory], {
			cwd: '/', stdio: 'pipe',
			...(process.getuid?.() === 0 ? { uid: owner.uid, gid: owner.gid } : {})
		});
	} catch (error) {
		throw new Error('Cannot lock Yjs data; stop the service and other writers before backup', { cause: error });
	}
	fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
	fs.mkdirSync(destination, { mode: 0o700 }); // Refuse an existing destination.
	try {
		const Database = require('better-sqlite3');
		const db = new Database(storage.dbFile, { readonly: true, fileMustExist: true });
		try { await db.backup(path.join(destination, 'server.db')); } finally { db.close(); }
		fs.chmodSync(path.join(destination, 'server.db'), 0o600);
		fs.cpSync(storage.yjsDirectory, path.join(destination, 'yjs-data'), {
			recursive: true,
			filter: source => {
				if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Refusing a symlink in Yjs data');
				return path.basename(source) !== '.htpasswd';
			}
		});
		const tokensPresent = fs.existsSync(storage.taskTokensFile);
		if (tokensPresent) {
			const tokens = fs.readFileSync(storage.taskTokensFile, 'utf8');
			if (!Array.isArray(JSON.parse(tokens).tokens)) throw new Error('Invalid task token configuration');
			fs.writeFileSync(path.join(destination, 'task-tokens.json'), tokens, { flag: 'wx', mode: 0o600 });
		}
		fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({
			version: 1, created: new Date().toISOString(), sources: {
				sqlite: storage.dbFile, yjs: storage.yjsDirectory, taskTokens: storage.taskTokensFile
			}, taskTokensPresent: tokensPresent, credentialsIncluded: false
		}, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
	} catch (error) {
		fs.rmSync(destination, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	/** @param {string} name */
	const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
	try {
		const serverDirectory = argument('--server-dir') ?? '/opt/lists_and_prices/server';
		const output = argument('--output');
		if (!output || !path.isAbsolute(output)) throw new Error('--output requires an absolute path');
		if (args.includes('--capture-service')) {
			const service = argument('--capture-service');
			if (!service) throw new Error('--capture-service requires a service name');
			const storage = captureServiceStorage(service, serverDirectory);
			fs.writeFileSync(output, JSON.stringify(storage), { flag: 'wx', mode: 0o600 });
		} else {
			const manifest = argument('--manifest');
			const storage = manifest ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : resolveStoragePaths(process.env, serverDirectory);
			await backupUserData(storage, output);
			console.log(`User-data backup created: ${output} (.htpasswd excluded)`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'Backup failed');
		process.exitCode = 1;
	}
}
