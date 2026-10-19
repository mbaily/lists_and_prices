import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { recordLegacyAssets, retainFrontend } from '../scripts/frontend-retention.mjs';

const day = 86400000;
function fixture(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'frontend-retention-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'), live = path.join(root, 'live'), history = path.join(root, 'history');
    for (const dir of [source, live]) mkdirSync(path.join(dir, '_app/immutable'), { recursive: true });
    const asset = (dir, name) => path.join(dir, '_app/immutable', name);
    function release(version, files, now) {
        rmSync(path.join(source, '_app/immutable'), { recursive: true });
        mkdirSync(path.join(source, '_app/immutable'));
        writeFileSync(path.join(source, '_app/version.json'), JSON.stringify({ version }));
        for (const file of files) {
            writeFileSync(asset(source, file), version);
            writeFileSync(asset(live, file), version);
        }
        return retainFrontend(source, live, history, { now });
    }
    return { root, source, live, history, asset, release };
}

test('legacy assets get a full grace period; newest three releases and current assets survive', t => {
    const f = fixture(t);
    writeFileSync(f.asset(f.live, 'legacy.js'), 'old browser');
    recordLegacyAssets(f.live, f.history, 0);
    f.release('0.0.1', ['one.js', 'shared.js'], day);
    f.release('0.0.2', ['two.js', 'shared.js'], 2 * day);
    f.release('0.0.3', ['three.js', 'shared.js'], 3 * day);
    f.release('0.0.4', ['four.js', 'shared.js'], 4 * day);
    assert.ok(existsSync(f.asset(f.live, 'legacy.js')));
    assert.ok(existsSync(f.asset(f.live, 'one.js')), 'recent release survives even beyond last three');
    const result = f.release('0.0.5', ['five.js', 'shared.js'], 20 * day);
    for (const file of ['three.js', 'four.js', 'five.js', 'shared.js']) assert.ok(existsSync(f.asset(f.live, file)), file);
    for (const file of ['legacy.js', 'one.js', 'two.js']) assert.ok(!existsSync(f.asset(f.live, file)), file);
    assert.equal(result.retainedReleases, 3);
    assert.equal(result.removed, 3);
});

test('retention leaves server state, nonimmutable files and unknown assets untouched', t => {
    const f = fixture(t);
    mkdirSync(path.join(f.live, 'server'));
    writeFileSync(path.join(f.live, 'server/notes.db'), 'private data');
    writeFileSync(path.join(f.live, 'index.html'), 'current index');
    recordLegacyAssets(f.live, f.history, 0);
    writeFileSync(f.asset(f.live, 'untracked.js'), 'not managed by deploy');
    f.release('0.0.1', ['new.js'], 10 * day);
    assert.equal(readFileSync(path.join(f.live, 'server/notes.db'), 'utf8'), 'private data');
    assert.equal(readFileSync(path.join(f.live, 'index.html'), 'utf8'), 'current index');
    assert.ok(existsSync(f.asset(f.live, 'untracked.js')));
});

test('missing current assets prevent cleanup', t => {
    const f = fixture(t);
    f.release('0.0.1', ['one.js'], day);
    rmSync(f.asset(f.live, 'one.js'));
    assert.throws(() => retainFrontend(f.source, f.live, f.history), /missing/);
});

test('symlinks and malformed history cannot redirect asset removal', t => {
    const f = fixture(t);
    recordLegacyAssets(f.live, f.history, 0);
    const outside = path.join(f.root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, f.asset(f.live, 'linked'));
    assert.throws(() => f.release('0.0.1', ['current.js'], day), /symlink/);
    rmSync(f.asset(f.live, 'linked'));
    writeFileSync(path.join(f.history, 'legacy.json'), JSON.stringify({ createdAt: 0, files: ['../../outside'] }));
    assert.throws(() => f.release('0.0.2', ['next.js'], 10 * day), /Invalid asset history/);
    assert.ok(existsSync(outside));
    assert.ok(existsSync(f.asset(f.live, 'current.js')));
});
