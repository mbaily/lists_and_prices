import * as Y from 'yjs';

type StackItem = Y.UndoManager['undoStack'][number];

/** Draft cancellation is selective undo, never replacement with a stale string.
 * A saved editing session becomes one application undo action. */
export class NoteEditSession {
	readonly undoManager: Y.UndoManager;
	private pending = new Set<StackItem>();
	private capture = ({ stackItem, origin }: { stackItem: StackItem; origin: unknown }) => {
		if (origin === this.origin || origin === this.undoManager) this.pending.add(stackItem);
	};

	constructor(private text: Y.Text, private origin: unknown, private globalUndo: Y.UndoManager) {
		this.undoManager = new Y.UndoManager(text, { trackedOrigins: new Set([origin]) });
		globalUndo.stopCapturing();
		globalUndo.addTrackedOrigin(origin);
		globalUndo.addTrackedOrigin(this.undoManager);
		globalUndo.on('stack-item-added', this.capture);
		globalUndo.on('stack-item-updated', this.capture);
	}

	get hasChanges(): boolean { return this.undoManager.canUndo(); }

	commit(): void {
		const stack = this.globalUndo.undoStack;
		const changes = stack.filter((item) => this.pending.has(item));
		if (changes.length > 1) {
			const combined: StackItem = {
				insertions: Y.mergeDeleteSets(changes.map((item) => item.insertions)),
				deletions: Y.mergeDeleteSets(changes.map((item) => item.deletions)),
				meta: new Map()
			};
			const last = stack.lastIndexOf(changes[changes.length - 1]);
			this.globalUndo.undoStack = stack.flatMap((item, idx) => idx === last ? [combined] : this.pending.has(item) ? [] : [item]);
		}
		this.pending.clear();
		this.undoManager.clear();
		this.globalUndo.stopCapturing();
	}

	discard(): void {
		while (this.undoManager.canUndo()) this.undoManager.undo();
		this.globalUndo.undoStack = this.globalUndo.undoStack.filter((item) => !this.pending.has(item));
		this.globalUndo.redoStack = this.globalUndo.redoStack.filter((item) => !this.pending.has(item));
		this.pending.clear();
		this.undoManager.clear();
		this.globalUndo.stopCapturing();
	}

	destroy(): void {
		// If navigation/peer deletion closes the editor, retain already synced
		// edits in the application undo history rather than silently losing them.
		this.commit();
		this.globalUndo.off('stack-item-added', this.capture);
		this.globalUndo.off('stack-item-updated', this.capture);
		this.globalUndo.removeTrackedOrigin(this.origin);
		this.globalUndo.removeTrackedOrigin(this.undoManager);
		this.undoManager.destroy();
	}
}