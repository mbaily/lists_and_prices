/** Shared by the server, token issuer and backup tooling; resolving paths does no I/O. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export interface StoragePaths {
	serverDirectory: string;
	dbFile: string;
	yjsDirectory?: string;
	taskTokensFile: string;
	htpasswdFile: string;
}

function optionalPath(env: NodeJS.ProcessEnv, name: string, cwd: string): string | undefined {
	const value = env[name];
	if (value === undefined) return undefined;
	if (!value.trim()) throw new Error(`${name} must be a nonempty path`);
	return path.resolve(cwd, value);
}

export function resolveStoragePaths(
	env: NodeJS.ProcessEnv = process.env,
	serverDirectory = path.dirname(fileURLToPath(import.meta.url)),
	cwd = process.cwd()
): StoragePaths {
	serverDirectory = path.resolve(cwd, serverDirectory);
	const root = optionalPath(env, 'LISTS_DATA_DIR', cwd);
	const paths: StoragePaths = {
		serverDirectory,
		dbFile: optionalPath(env, 'LISTS_DB_PATH', cwd) ?? path.join(root ?? serverDirectory, 'server.db'),
		yjsDirectory: optionalPath(env, 'YPERSISTENCE', cwd) ?? (root ? path.join(root, 'yjs-data') : undefined),
		taskTokensFile: optionalPath(env, 'LISTS_TASK_TOKENS_PATH', cwd) ?? path.join(root ?? serverDirectory, 'task-tokens.json'),
		htpasswdFile: path.join(serverDirectory, '.htpasswd')
	};
	if (new Set([paths.dbFile, paths.taskTokensFile, paths.htpasswdFile]).size !== 3) {
		throw new Error('SQLite, task tokens and .htpasswd must use separate files');
	}
	if (paths.yjsDirectory && [paths.dbFile, paths.taskTokensFile, paths.htpasswdFile].some(file => {
		const relative = path.relative(paths.yjsDirectory!, file);
		return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
	})) throw new Error('The Yjs directory must not contain SQLite, task tokens or .htpasswd');
	return paths;
}

export function ensureStorageDirectories(paths: StoragePaths): void {
	for (const directory of [path.dirname(paths.dbFile), path.dirname(paths.taskTokensFile), paths.yjsDirectory]) {
		if (directory) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	}
}
