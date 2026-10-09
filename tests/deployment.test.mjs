import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './helpers/app.mjs';

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'lists deploy '));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bin = path.join(directory, 'bin'); mkdirSync(bin);
    const command = (name, code) => writeFileSync(path.join(bin, name), '#!/bin/bash\nset -e\n' + code, { mode: 0o755 });
    command('sudo', 'if [[ "${1:-}" = -v ]]; then exit 0; fi\nif [[ "${1:-}" = -n ]]; then shift; fi\nif [[ "${1:-}" = -u ]]; then shift 2; fi\nif [[ "${1:-}" = chown ]]; then exit 0; fi\nexec "$@"\n');
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, SERVICE_USER: userInfo().username };
    const source = path.join(directory, 'checkout'), dest = path.join(directory, 'live');
    for (const base of [source, dest]) {
        for (const folder of ['build', 'server/yjs-data', 'node_modules', 'src/lib']) mkdirSync(path.join(base, folder), { recursive: true });
        for (const [file, content] of Object.entries({ 'build/index.html': base === source ? 'new app' : 'old app', 'build/sw.js': 'worker', 'server/index.ts': base === source ? 'new server' : 'old server', 'server/tsconfig.json': '{}', 'package.json': '{}', 'package-lock.json': '{}', 'node_modules/marker': base === source ? 'new deps' : 'old deps' })) writeFileSync(path.join(base, file), content);
        for (const file of ['server/yjs-data/notes', 'server/server.db', 'server/server.db-wal', 'server/server.db-shm', 'server/.htpasswd', 'server/cert.pem', 'server/key.pem', '.env']) writeFileSync(path.join(base, file), base === source ? 'checkout must never overwrite this' : 'live private data');
        writeFileSync(path.join(base, 'src/lib/folderDefaultItems.ts'), base === source ? 'new shared module' : 'old shared module');
    }
    writeFileSync(path.join(source, 'src/lib/unrelated.ts'), 'not deployed');
    writeFileSync(path.join(dest, 'build/old-hashed.js'), 'old asset');
    const sync = (extra = '') => execFileSync('bash', ['-c', 'set -euo pipefail; source "$1/scripts/deploy-runtime.sh"; sync_runtime "$2" "$3" ' + extra, 'probe', root, source, dest], { env, encoding: 'utf8' });
    return { directory, bin, command, env, source, dest, sync };
}

function assertPrivateData(dest) {
    for (const file of ['server/yjs-data/notes', 'server/server.db', 'server/server.db-wal', 'server/server.db-shm', 'server/.htpasswd', 'server/cert.pem', 'server/key.pem', '.env']) assert.equal(readFileSync(path.join(dest, file), 'utf8'), 'live private data', file);
}

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
    assert.ok(!readdirSync(path.join(f.dest, 'src/lib')).includes('unrelated.ts'));
});

test('preview changes no application or data files', t => {
    const f = fixture(t); f.sync('--dry-run'); assertPrivateData(f.dest);
    assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
    assert.equal(readFileSync(path.join(f.dest, 'node_modules/marker'), 'utf8'), 'old deps');
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'old shared module');
});

test('runtime copy supports installations and rollback backups without shared modules', t => {
    const f = fixture(t);
    rmSync(path.join(f.dest, 'src'), { recursive: true });
    f.sync('--dry-run');
    assert.ok(!readdirSync(f.dest).includes('src'));
    f.sync();
    assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'new shared module');
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

for (const failure of ['none', 'build', 'dependencies', 'health']) {
    test(`deployment ${failure}: staged dependencies, consistent backup and rollback`, t => {
        const f = fixture(t);
        // Execute the real deploy script from an isolated checkout.
        mkdirSync(path.join(f.source, 'scripts'));
        writeFileSync(path.join(f.source, 'deploy.sh'), readFileSync(path.join(root, 'deploy.sh')));
        writeFileSync(path.join(f.source, 'scripts/deploy-runtime.sh'), readFileSync(path.join(root, 'scripts/deploy-runtime.sh')));
        f.command('npm', 'echo "npm $*" >> "$TEST_LOG"\nif [[ "$1" = run && "$TEST_FAILURE" = build ]]; then exit 1; fi\nif [[ "$*" = *--prefix* ]]; then\n if [[ "$TEST_FAILURE" = dependencies ]]; then exit 1; fi\n while [[ "$1" != --prefix ]]; do shift; done\n mkdir -p "$2/node_modules"; echo "prepared deps" > "$2/node_modules/marker"\nfi\n');
        f.command('mktemp', 'if [[ "$*" = *"/opt/lists-deploy-stage"* ]]; then exec /usr/bin/mktemp -d "$TEST_ROOT/stage.XXXXXX"; fi\nexec /usr/bin/mktemp "$@"\n');
        f.command('systemctl', 'echo "systemctl $*" >> "$TEST_LOG"\nexit 0\n');
        f.command('sleep', 'exit 0\n');
        f.command('journalctl', 'exit 0\n');
        f.command('node', 'exit 0\n');
        f.command('curl', 'if [[ "$TEST_FAILURE" = health ]]; then exit 22; fi\nargs="$*"\nwhile [[ "$1" != -o ]]; do shift; done\nif [[ "$args" = *api/session* ]]; then echo \'{"error":"Invalid session"}\' > "$2"; printf 401; else cp "$LISTS_DEPLOY_DIR/build/index.html" "$2"; fi\n');
        const log = path.join(f.directory, 'commands.log'); writeFileSync(log, '');
        const backups = path.join(f.directory, 'backups');
        const env = { ...f.env, LISTS_DEPLOY_DIR: f.dest, LISTS_BACKUP_DIR: backups, LISTS_SERVICE_USER: userInfo().username, TEST_ROOT: f.directory, TEST_LOG: log, TEST_FAILURE: failure };
        const run = () => execFileSync('bash', [path.join(f.source, 'deploy.sh')], { env, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        if (failure === 'none') run(); else assert.throws(run);
        assertPrivateData(f.dest);
        const commands = readFileSync(log, 'utf8');
        if (failure === 'build' || failure === 'dependencies') {
            assert.doesNotMatch(commands, /systemctl stop/);
            assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), 'old app');
        } else {
            const backup = readdirSync(backups).find(name => name.startsWith('deploy-'));
            assert.ok(backup); assertPrivateData(path.join(backups, backup));
            assert.ok(commands.indexOf('npm rebuild') < commands.indexOf('systemctl stop'));
            assert.equal(readFileSync(path.join(f.dest, 'build/index.html'), 'utf8'), failure === 'none' ? 'new app' : 'old app');
            assert.equal(readFileSync(path.join(f.dest, 'node_modules/marker'), 'utf8').trim(), failure === 'none' ? 'prepared deps' : 'old deps');
            assert.equal(readFileSync(path.join(backups, backup, 'src/lib/folderDefaultItems.ts'), 'utf8'), 'old shared module');
            assert.equal(readFileSync(path.join(f.dest, 'src/lib/folderDefaultItems.ts'), 'utf8'), failure === 'none' ? 'new shared module' : 'old shared module');
            assert.match(commands, /systemctl start/);
        }
    });
}
