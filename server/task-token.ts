/** Issue a per-user, optionally per-list API token without opening live Yjs data. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { isValidUsername, readHtpasswdHash } from './auth.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argument = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const username = argument('--user'), listId = argument('--list'), output = argument('--output'), fromPhotos = args.includes('--from-photos');
if (!username || !isValidUsername(username) || !output || !path.isAbsolute(output) || (args.includes('--list') && !listId)) {
	console.error('Usage: node --import tsx server/task-token.ts --user USER [--list LIST_ID] [--from-photos] --output /absolute/private/token-file');
	process.exit(2);
}
if (!readHtpasswdHash(fs.readFileSync(path.join(directory, '.htpasswd'), 'utf8'), username)) {
	throw new Error('The user must already exist.');
}
const file = path.join(directory, 'task-tokens.json');
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { tokens: [] };
if (!Array.isArray(config.tokens)) throw new Error('Invalid task token configuration');
const token = randomBytes(32).toString('hex');
const temporary = `${file}.${randomUUID()}.tmp`;
fs.writeFileSync(output, token + '\n', { mode: 0o600, flag: 'wx' });
try {
	config.tokens.push({ username, tokenHash: createHash('sha256').update(token).digest('hex'), ...(listId || fromPhotos ? { listIds: listId ? [listId] : [] } : {}), ...(fromPhotos ? { fromPhotos: true } : {}) });
	fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
	fs.renameSync(temporary, file);
} catch (error) {
	fs.rmSync(output, { force: true });
	throw error;
} finally { fs.rmSync(temporary, { force: true }); }
console.log('Task token created; read it from the private output file.');
