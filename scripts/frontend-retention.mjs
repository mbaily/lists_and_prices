// Called under deploy.sh's lock. Only generated immutable frontend assets expire.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const validAsset = file => typeof file === 'string' && file.startsWith('_app/immutable/') &&
    !file.includes('\\') && !file.split('/').some(part => !part || part === '.' || part === '..');

function inventory(build) {
    const files = [];
    function walk(directory) {
        if (!existsSync(directory)) return;
        if (lstatSync(directory).isSymbolicLink()) throw new Error(`Refusing asset symlink: ${directory}`);
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error(`Refusing asset symlink: ${file}`);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) files.push(path.relative(build, file).split(path.sep).join('/'));
        }
    }
    if (lstatSync(build).isSymbolicLink()) throw new Error(`Refusing build symlink: ${build}`);
    if (existsSync(path.join(build, '_app')) && lstatSync(path.join(build, '_app')).isSymbolicLink()) {
        throw new Error('Refusing symlinked _app directory');
    }
    walk(path.join(build, '_app/immutable'));
    return files;
}

function save(directory, name, data) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Refusing symlinked asset history');
    const temporary = path.join(directory, `.${name}.${process.pid}.tmp`);
    writeFileSync(temporary, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path.join(directory, name));
}

export function recordLegacyAssets(build, history, now = Date.now()) {
    if (existsSync(path.join(history, 'legacy.json')) ||
        (existsSync(history) && readdirSync(history).some(name => name.startsWith('release-')))) return;
    // Existing installations have no history. Give all their assets a full grace
    // period; do not infer last use from old build timestamps.
    save(history, 'legacy.json', { createdAt: now, files: inventory(build) });
}

export function retainFrontend(source, destination, history, { now = Date.now(), graceDays = 7, keepReleases = 3 } = {}) {
    if (!Number.isFinite(graceDays) || graceDays < 1 || !Number.isInteger(keepReleases) || keepReleases < 2) {
        throw new Error('Keep at least two frontend releases and one day of compatibility assets');
    }
    const version = read(path.join(source, '_app/version.json')).version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid frontend version');
    const current = { createdAt: now, files: inventory(source) };
    const installed = new Set(inventory(destination));
    if (current.files.some(file => !installed.has(file))) throw new Error('Current frontend assets are missing; cleanup skipped');
    save(history, `release-${version}.json`, current);
    const manifests = readdirSync(history).filter(name => /^release-\d+\.\d+\.\d+\.json$/.test(name))
        .map(name => ({ name, ...read(path.join(history, name)) }))
        .sort((a, b) => b.createdAt - a.createdAt);
    const baseline = path.join(history, 'legacy.json');
    const legacy = existsSync(baseline) ? read(baseline) : null;
    for (const manifest of [...manifests, ...(legacy ? [legacy] : [])]) {
        if (!Number.isFinite(manifest.createdAt) || !Array.isArray(manifest.files) || !manifest.files.every(validAsset)) {
            throw new Error('Invalid asset history; cleanup skipped');
        }
    }
    const cutoff = now - graceDays * 86400000;
    const retained = manifests.filter((m, index) => index < keepReleases || m.createdAt >= cutoff);
    const protectedFiles = new Set([...current.files, ...retained.flatMap(m => m.files),
        ...(legacy && legacy.createdAt >= cutoff ? legacy.files : [])]);
    const knownFiles = new Set([...manifests.flatMap(m => m.files), ...(legacy ? legacy.files : [])]);
    let removed = 0;
    for (const file of knownFiles) {
        if (!protectedFiles.has(file) && installed.has(file)) {
            unlinkSync(path.join(destination, file));
            removed++;
        }
    }
    for (const manifest of manifests) {
        if (!retained.includes(manifest)) unlinkSync(path.join(history, manifest.name));
    }
    if (legacy && legacy.createdAt < cutoff) unlinkSync(baseline);
    return { removed, retainedReleases: retained.length, graceDays };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [action, ...args] = process.argv.slice(2);
        if (action === 'before' && args.length === 2) recordLegacyAssets(...args);
        else if (action === 'after' && args.length === 3) console.log('Frontend asset retention:', retainFrontend(...args));
        else throw new Error('Usage: frontend-retention.mjs before BUILD HISTORY | after SOURCE_BUILD LIVE_BUILD HISTORY');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
