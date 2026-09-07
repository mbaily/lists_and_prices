import * as Y from 'yjs';

function cloneValue(value: unknown): unknown {
	if (value instanceof Y.Map || value instanceof Y.Array || value instanceof Y.Text) return value.clone();
	return value;
}

/** A self-contained, read-only checkpoint. Do not include other commits:
 * nesting their checkpoint bytes would grow history exponentially. Keeping
 * current values rather than relying only on deleted structs also protects
 * new commits from older clients/persistence adapters that still perform GC. */
export function encodeCommitState(source: Y.Doc): Uint8Array {
	const copy = new Y.Doc({ gc: false });
	try {
		copy.transact(() => {
			for (const key of source.share.keys()) {
				if (key === 'commits') continue;
				if (['folders', 'lists', 'items', 'spreadsheets'].includes(key)) {
					copy.getArray(key).push(source.getArray(key).toArray().map(cloneValue));
				} else if (key.startsWith('note_text_')) {
					copy.getText(key).applyDelta(source.getText(key).toDelta());
				} else {
					const target = copy.getMap(key);
					source.getMap(key).forEach((value, name) => target.set(name, cloneValue(value)));
				}
			}
		});
		return Y.encodeStateAsUpdate(copy);
	} finally {
		copy.destroy();
	}
}