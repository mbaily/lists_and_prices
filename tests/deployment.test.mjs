import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './helpers/app.mjs';
import { checkReleaseVersion, checkBuiltVersion } from '../scripts/check-release-version.mjs';

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'lists deploy '));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bin = path.join(directory, 'bin'); mkdirSync(bin);
    const command = (name, code) => writeFileSync(path.join(bin, name), '#!/bin/bash\nset -e\n' + code, { mode: 0o755 });
    command('sudo', 'if [[ "${1:-}" = -v ]]; then exit 0; fi\nif [[ "${1:-}" = -n ]]; then shift; fi\nif [[ "${1:-}" = -u ]]; then shift 2; fi\nif [[ "${1:-}" = chown ]]; then exit 0; fi\nexec "$@"\n');
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, SERVICE_USER: userInfo().username };
    const source = path.join(directory, 'checkout'), dest = path.join(directory, 'live');
    for (const base of [source, dest]) {
        for (const folder of ['build/_app', 'server/yjs-data', 'node_modules', 'src/lib']) mkdirSync(path.join(base, folder), { recursive: true });
        for (const [file, content] of Object.entries({ 'build/index.html': base === source ? 'new app' : 'old app', 'build/sw.js': 'worker', 'server/index.ts': base === source ? 'new server' : 'old server', 'server/tsconfig.json': '{}', 'package.json': '{}', 'package-lock.json': '{}', 'node_modules/marker': base === source ? 'new deps' : 'old deps' })) writeFileSync(path.join(base, file), content);
        for (const file of ['server/yjs-data/notes', 'server/server.db', 'server/server.db-wal', 'server/server.db-shm', 'server/.htpasswd', 'server/cert.pem', 'server/key.pem', '.env']) writeFileSync(path.join(base, file), base === source ? 'checkout must never overwrite this' : 'live private data');
        const version = base === source ? '0.0.2' : '0.0.1';
        writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'test-deployment', version }));
        writeFileSync(path.join(base, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
        writeFileSync(path.join(base, 'build/_app/version.json'), JSON.stringify({ version }));
        writeFileSync(path.join(base, 'src/lib/folderDefaultItems.ts'), base === source ? 'new shared module' : 'old shared module');
        writeFileSync(path.join(base, 'src/lib/syncProtocol.ts'), base === source ? 'new sync protocol' : 'old sync protocol');
    }
    writeFileSync(path.join(source, 'src/lib/unrelated.ts'), 'not deployed');
    writeFileSync(path.join(dest, 'build/old-hashed.js'), 'old asset');
    const sync = (extra = '') => execFileSync('bash', ['-c', 'set -euo pipefail; source "$1/scripts/deploy-runtime.sh"; sync_runtime "$2" "$3" ' + extra, 'probe', root, source, dest], { env, encoding: 'utf8' });
    return { directory, bin, command, env, source, dest, sync };
}

function assertPrivateData(dest) {
    for (const file of ['server/yjs-data/notes', 'server/server.db', 'server/server.db-wal', 'server/server.db-shm', 'server/.htpasswd', 'server/cert.pem', 'server/key.pem', '.env']) assert.equal(readFileSync(path.join(dest, file), 'utf8'), 'live private data', file);
}

test('release versions compare numerically and require matching manifest and lockfile versions', t => {
    const f = fixture(t);
    const setSource = version => {
        writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ version }));
        writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
    };
    for (const [installed, next] of [['0.0.9', '0.0.10'], ['0.9.9', '0.10.0'], ['0.99.99', '1.0.0']]) {
        writeFileSync(path.join(f.dest, 'package.json'), JSON.stringify({ version: installed }));
        setSource(next);
        assert.equal(checkReleaseVersion(f.source, f.dest).version, next);
        setSource(installed);
        assert.throws(() => checkReleaseVersion(f.source, f.dest), /must be newer/);
    }
    for (const version of ['0.0.1', '0.0.02', '0.0.2-beta', 'not-a-version']) {
        setSource(version);
        assert.throws(() => checkReleaseVersion(f.source, f.dest), /must be newer|MAJOR.MINOR.PATCH/);
    }
    setSource('2.0.0');
    writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ version: '2.0.0', packages: { '': { version: '1.0.0' } } }));
    assert.throws(() => checkReleaseVersion(f.source, f.dest), /lock/);
});

test('a stale built client version cannot be released under a newer package version', t => {
    const f = fixture(t);
    assert.equal(checkBuiltVersion(f.source), '0.0.2');
    writeFileSync(path.join(f.source, 'build/_app/version.json'), JSON.stringify({ version: '0.0.1' }));
    assert.throws(() => checkBuiltVersion(f.source), /Built client version/);
});

test('native validation resolves the staged package without reading the caller’s package config', t => {
    const f = fixture(t);
    // An unreadable/malformed caller package must not affect the staged runtime.
    writeFileSync(path.join(f.source, 'package.json'), '{invalid checkout configuration');
    const addon = path.join(f.dest, 'node_modules/better-sqlite3'); mkdirSync(addon);
    writeFileSync(path.join(addon, 'index.js'), 'module.exports = class { constructor(name) { if (name !== ":memory:") throw new Error("Unexpected database"); } close() { console.log("Staged addon validated"); } };');
    const result = execFileSync('bash', ['-c', 'set -euo pipefail; source "$1/scripts/deploy-runtime.sh"; cd "$2"; validate_runtime "$3"', 'probe', root, f.source, f.dest], { env: f.env, encoding: 'utf8' });
    assert.match(result, /Staged addon validated/);
    assertPrivateData(f.dest);
});

test('deployment lock blocks a second deployment before copying', async t => {
    const f = fixture(t);
    const backups = path.join(f.directory, 'backups'); mkdirSync(backups);
    const holder = spawn('flock', ['-n', path.join(backups, 'deploy.lock'), 'bash', '-c', 'echo locked; cat'], { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => holder.stdin.end());
    await once(holder.stdout, 'data');
    assert.throws(() => execFileSync('bash', [path.join(root, 'deploy.sh'), '--dry-run'], {
        env: { ...f.env, LISTS_DEPLOY_DIR: f.dest, LISTS_BACKUP_DIR: backups },
        encoding: 'utf8', timeout: 5000
    }), /Another deployment holds the lock/);
    assertPrivateData(f.dest);
    assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
});

test('runtime copy preserves live data, secrets and old frontend assets', t => {
    const f = fixture(t); f.sync();
    assertPrivateData(f.dest);
    assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'new app');
    assert.equal(readFileSync(path.join(f.dest, 'server/index.ts'), 'utf8'), 'new server');
    assert.equal(readFileSync(path.join(f.dest, 'node_modules/marker'), 'utf8'), 'new deps');
    assert.equal(readFileSync(path.join(f.dest, 'build/old-hashed.js'), 'utf8'), 'old asset');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'new shared module');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/syncProtocol.ts'), 'utf8'), 'new sync protocol');
    assert.ok(!readdirSync(path.join(f.dest, 'src/lib')).includes('unrelated.ts'));
});

test('preview changes no application or data files', t => {
    const f = fixture(t); f.sync('--dry-run'); assertPrivateData(f.dest);
    assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
    assert.equal(readFileSync(path.join(f.dest, 'node_modules/marker'), 'utf8'), 'old deps');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'old shared module');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/syncProtocol.ts'), 'utf8'), 'old sync protocol');
});

test('runtime copy supports installations and rollback backups without shared modules', t => {
    const f = fixture(t);
    rmSync(path.join(f.dest, 'src'), { recursive: true });
    f.sync('--dry-run');
    assert.ok(!readdirSync(f.dest).includes('src'));
    f.sync();
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'new shared module');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/syncProtocol.ts'), 'utf8'), 'new sync protocol');
    rmSync(path.join(f.source, 'src'), { recursive: true });
    f.sync();
    assertPrivateData(f.dest);
});

test('symlinked data/runtime directory is rejected before copying', t => {
    const f = fixture(t); rmSync(path.join(f.dest, 'server'), { recursive: true });
    symlinkSync(path.join(f.source, 'server'), path.join(f.dest, 'server'));
    assert.throws(() => f.sync(), /Refusing symlink/);
    assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
});

for (const failure of ['none', 'version', 'lock-version', 'build', 'built-version', 'dependencies', 'health', 'sync-health', 'served-version']) {
    test(`deployment ${failure}: staged dependencies, consistent backup and rollback`, t => {
        const f = fixture(t);
        // Execute the real deploy script from an isolated checkout.
        mkdirSync(path.join(f.source, 'scripts'));
        writeFileSync(path.join(f.source, 'deploy.sh'), readFileSync(path.join(root, 'deploy.sh')));
        writeFileSync(path.join(f.source, 'scripts/deploy-runtime.sh'), readFileSync(path.join(root, 'scripts/deploy-runtime.sh')));
        writeFileSync(path.join(f.source, 'scripts/check-release-version.mjs'), readFileSync(path.join(root, 'scripts/check-release-version.mjs')));
        writeFileSync(path.join(f.source, 'scripts/frontend-retention.mjs'), readFileSync(path.join(root, 'scripts/frontend-retention.mjs')));
        if (failure === 'version') {
            for (const file of ['package.json', 'package-lock.json']) writeFileSync(path.join(f.source, file), readFileSync(path.join(f.dest, file)));
        }
        if (failure === 'lock-version') writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ version: '0.0.1', packages: { '': { version: '0.0.1' } } }));
        if (failure === 'built-version') writeFileSync(path.join(f.source, 'build/_app/version.json'), JSON.stringify({ version: '0.0.1' }));
        f.command('npm', 'echo "npm $*" >> "$TEST_LOG"\nif [[ "$1" = run && "$TEST_FAILURE" = build ]]; then exit 1; fi\nif [[ "$*" = *--prefix* ]]; then\n if [[ "$TEST_FAILURE" = dependencies ]]; then exit 1; fi\n while [[ "$1" != --prefix ]]; do shift; done\n mkdir -p "$2/node_modules"; echo "prepared deps" > "$2/node_modules/marker"\nfi\n');
        f.command('mktemp', 'if [[ "$*" = *"/opt/lists-deploy-stage"* ]]; then exec /usr/bin/mktemp -d "$TEST_ROOT/stage.XXXXXX"; fi\nexec /usr/bin/mktemp "$@"\n');
        f.command('systemctl', 'echo "systemctl $*" >> "$TEST_LOG"\nexit 0\n');
        f.command('sleep', 'exit 0\n');
        f.command('journalctl', 'exit 0\n');
        f.command('node', "if [[ \"$1\" = */check-release-version.mjs || \"$1\" = */frontend-retention.mjs ]]; then exec \"$TEST_NODE\" \"$@\"; fi\nexit 0\n");
        f.command('curl', "echo \"curl $*\" >> \"$TEST_LOG\"\nif [[ \"$TEST_FAILURE\" = health ]]; then exit 22; fi\nargs=\"$*\"\nwhile [[ \"$1\" != -o ]]; do shift; done\nif [[ \"$args\" = */_app/version.json* ]]; then\n if [[ \"$TEST_FAILURE\" = served-version ]]; then printf '{\"version\":\"0.0.1\"}' > \"$2\"; else cp \"$LISTS_DEPLOY_DIR/build/_app/version.json\" \"$2\"; fi\n exit 0\nfi\nif [[ \"$args\" = *api/sync* && \"$TEST_FAILURE\" = sync-health ]]; then echo '{\"error\":\"Not found\"}' > \"$2\"; printf 404; elif [[ \"$args\" = *api/session* || \"$args\" = *api/sync* ]]; then echo '{\"error\":\"Invalid session\"}' > \"$2\"; printf 401; else cp \"$LISTS_DEPLOY_DIR/build/index.html\" \"$2\"; fi\n");
        const log = path.join(f.directory, 'commands.log'); writeFileSync(log, '');
        const backups = path.join(f.directory, 'backups');
        const env = { ...f.env, LISTS_DEPLOY_DIR: f.dest, LISTS_BACKUP_DIR: backups, LISTS_SERVICE_USER: userInfo().username, TEST_ROOT: f.directory, TEST_LOG: log, TEST_FAILURE: failure, TEST_NODE: process.execPath };
        const run = () => execFileSync('bash', [path.join(f.source, 'deploy.sh')], { env, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        if (failure === 'none') run(); else assert.throws(run);
        assertPrivateData(f.dest);
        const commands = readFileSync(log, 'utf8');
        if (['version', 'lock-version', 'build', 'built-version', 'dependencies'].includes(failure)) {
            assert.doesNotMatch(commands, /systemctl stop/);
            assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
        } else {
            const backup = readdirSync(backups).find(name => name.startsWith('deploy-'));
            assert.ok(backup); assertPrivateData(path.join(backups, backup));
            assert.ok(commands.indexOf('npm rebuild') < commands.indexOf('systemctl stop'));
            assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), failure === 'none' ? 'new app' : 'old app');
            assert.equal(readFileSync(path.join(f.dest, 'node_modules/marker'), 'utf8').trim(), failure === 'none' ? 'prepared deps' : 'old deps');
            assert.equal(readFileSync(path.join(backups, backup, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'old shared module');
            assert.equal(readFileSync(path.join(backups, backup, 'src/lib/syncProtocol.ts'), 'utf8'), 'old sync protocol');
            assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), failure === 'none' ? 'new shared module' : 'old shared module');
            assert.equal(readFileSync(path.join(f.dest, 'src/lib/syncProtocol.ts'), 'utf8'), failure === 'none' ? 'new sync protocol' : 'old sync protocol');
            assert.match(commands, /systemctl start/);
            if (failure === 'none' || failure === 'sync-health') assert.match(commands, /api\/sync/);
            assert.equal(existsSync(path.join(backups, 'frontend-assets/release-0.0.2.json')), failure === 'none', 'Only a healthy deployment records a new frontend release');
        }
    });
}
