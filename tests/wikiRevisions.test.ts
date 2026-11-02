import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { thinRevisions, type WikiRevision } from '../src/lib/wiki/revisions';

test('thinRevisions keeps all revisions when count <= 2', () => {
	const revs: WikiRevision[] = [
		{ timestamp: '2026-11-01T00:00:00Z', title: 'T1', content: 'C1', summary: 'S1', isMinor: false },
		{ timestamp: '2026-11-02T00:00:00Z', title: 'T2', content: 'C2', summary: 'S2', isMinor: false }
	];
	const thinned = thinRevisions(revs);
	strictEqual(thinned.length, 2);
});

test('thinRevisions preserves non-minor edits under 24 hours and thins rapid minor edits', () => {
	const now = new Date('2026-11-03T12:00:00Z');
	const revs: WikiRevision[] = [
		{ timestamp: '2026-11-03T01:00:00Z', title: 'T', content: 'Init', summary: '', isMinor: false },
		// 3 rapid minor edits 5 minutes apart
		{ timestamp: '2026-11-03T02:00:00Z', title: 'T', content: 'm1', summary: '', isMinor: true },
		{ timestamp: '2026-11-03T02:05:00Z', title: 'T', content: 'm2', summary: '', isMinor: true },
		{ timestamp: '2026-11-03T02:10:00Z', title: 'T', content: 'm3', summary: '', isMinor: true },
		// non-minor edits 10 minutes apart
		{ timestamp: '2026-11-03T05:00:00Z', title: 'T', content: 'Major 1', summary: '', isMinor: false },
		{ timestamp: '2026-11-03T05:10:00Z', title: 'T', content: 'Major 2', summary: '', isMinor: false },
		{ timestamp: '2026-11-03T11:00:00Z', title: 'T', content: 'Latest', summary: '', isMinor: false }
	];

	const thinned = thinRevisions(revs, now);
	// Rapid minor edits m2 and m3 (less than 1h from m1) should be thinned, but major edits kept
	strictEqual(thinned.some(r => r.content === 'm1'), true);
	strictEqual(thinned.some(r => r.content === 'm2'), false);
	strictEqual(thinned.some(r => r.content === 'Major 1'), true);
	strictEqual(thinned.some(r => r.content === 'Major 2'), true);
	strictEqual(thinned[0].content, 'Init');
	strictEqual(thinned[thinned.length - 1].content, 'Latest');
});

test('thinRevisions thins 7-day to 30-day edits to 1 per day', () => {
	const now = new Date('2026-11-20T12:00:00Z');
	// 5 edits on 2026-11-05 (15 days ago, in the 7-30 day window)
	const revs: WikiRevision[] = [
		{ timestamp: '2026-10-01T00:00:00Z', title: 'T', content: 'Origin', summary: '', isMinor: false },
		{ timestamp: '2026-11-05T08:00:00Z', title: 'T', content: 'Day 5 A', summary: '', isMinor: false },
		{ timestamp: '2026-11-05T10:00:00Z', title: 'T', content: 'Day 5 B', summary: '', isMinor: false },
		{ timestamp: '2026-11-05T14:00:00Z', title: 'T', content: 'Day 5 C', summary: '', isMinor: false },
		{ timestamp: '2026-11-20T11:00:00Z', title: 'T', content: 'Current', summary: '', isMinor: false }
	];

	const thinned = thinRevisions(revs, now);
	// Should keep Origin, only one from Day 5, and Current
	strictEqual(thinned.length, 3);
	strictEqual(thinned[0].content, 'Origin');
	strictEqual(thinned[1].content, 'Day 5 A');
	strictEqual(thinned[2].content, 'Current');
});

test('thinRevisions respects max cap', () => {
	const now = new Date('2026-11-03T12:00:00Z');
	const revs: WikiRevision[] = [];
	for (let i = 0; i < 50; i++) {
		revs.push({
			timestamp: new Date(now.getTime() - (50 - i) * 60 * 1000).toISOString(),
			title: `Title ${i}`,
			content: `Content ${i}`,
			summary: '',
			isMinor: false
		});
	}

	const thinned = thinRevisions(revs, now, 10);
	strictEqual(thinned.length <= 10, true);
	strictEqual(thinned[0].title, 'Title 0'); // first kept
	strictEqual(thinned[thinned.length - 1].title, 'Title 49'); // last kept
});
