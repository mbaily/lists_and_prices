import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (root, file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(version) {
    if (typeof version !== 'string' || !stableVersion.test(version)) throw new Error('Release versions must use MAJOR.MINOR.PATCH (for example, 0.0.2).');
    return version.split('.').map(BigInt);
}

function sourceVersion(root) {
    const { version } = read(root, 'package.json');
    parseVersion(version);
    const lock = read(root, 'package-lock.json');
    if (lock.version !== version || lock.packages?.['']?.version !== version) {
        throw new Error('package.json and both root package-lock.json versions must match. Run npm version patch --no-git-tag-version and commit both files.');
    }
    return version;
}

export function checkReleaseVersion(source, installed) {
    const version = sourceVersion(source);
    const current = read(installed, 'package.json').version;
    const nextParts = parseVersion(version), currentParts = parseVersion(current);
    const differing = nextParts.findIndex((part, index) => part !== currentParts[index]);
    if (differing === -1 || nextParts[differing] < currentParts[differing]) {
        throw new Error(`Release ${version} must be newer than installed ${current}. Before deploying, run npm version patch --no-git-tag-version and commit package.json and package-lock.json.`);
    }
    return { version, current };
}

export function checkBuiltVersion(source) {
    const version = sourceVersion(source);
    if (read(source, 'build/_app/version.json').version !== version) {
        throw new Error(`Built client version does not match release ${version}. Rebuild the web client before deployment.`);
    }
    return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv[2] === '--built' && process.argv.length === 4) {
            console.log(`Built client version verified: ${checkBuiltVersion(process.argv[3])}`);
        } else if (process.argv.length === 4) {
            const { version, current } = checkReleaseVersion(process.argv[2], process.argv[3]);
            console.log(`Release version: ${version} (installed: ${current})`);
        } else {
            throw new Error('Usage: check-release-version.mjs SOURCE INSTALLED | --built SOURCE');
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
