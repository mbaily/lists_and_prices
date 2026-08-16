<script lang="ts">
	import type { SyncStatus } from '$lib/yjsStore.svelte';
	import { getDoc, docState } from '$lib/yjsStore.svelte';
	import { readFolders, readLists, readAllItems } from '$lib/data';
	import * as Y from 'yjs';
	import InfoDialog from './InfoDialog.svelte';

	let { status }: { status: SyncStatus } = $props();

	const color: Record<SyncStatus, string> = {
		offline: '#ef4444',
		connecting: '#f97316',
		synced: '#22c55e'
	};

	let showDialog = $state(false);

	// Recompute stats whenever docState changes, but only if the dialog is open to save CPU
	let statsRows = $derived(showDialog ? (() => {
		// Use docState.version to force Svelte to re-evaluate this when the document changes
		void docState.version;
		
		try {
			const doc = getDoc();
			const folders = readFolders();
			const lists = readLists();
			const items = readAllItems();
			
			let todosCount = 0;
			let notesCount = 0;
			let headingsCount = 0;
			let maxDate = '';

			for (const item of items) {
				if (item.heading) headingsCount++;
				else if (item.note) notesCount++;
				else todosCount++;

				if (item.updatedAt && item.updatedAt > maxDate) maxDate = item.updatedAt;
			}
			
			for (const list of lists) {
				if (list.updatedAt && list.updatedAt > maxDate) maxDate = list.updatedAt;
			}
			
			for (const folder of folders) {
				if (folder.updatedAt && folder.updatedAt > maxDate) maxDate = folder.updatedAt;
			}

			// Safe sizes and checksum
			const totalSize = Y.encodeStateAsUpdate(doc).byteLength;
			const sv = Y.encodeStateVector(doc);
			const vectorSize = sv.byteLength;
			
			// Compute a quick 8-character hex checksum (djb2) of the state vector
			let hash = 5381;
			for (let i = 0; i < sv.length; i++) {
				hash = ((hash << 5) + hash) + sv[i];
			}
			const checksum = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
			
			const formatSize = (bytes: number) => {
				if (bytes < 1024) return `${bytes} B`;
				return `${(bytes / 1024).toFixed(2)} KB`;
			};
			
			return [
				{ label: 'Sync Checksum', value: checksum },
				{ label: 'Total Sync Size', value: formatSize(totalSize) },
				{ label: 'State Vector Size', value: formatSize(vectorSize) },
				{ label: 'Sync Client ID', value: doc.clientID.toString() },
				{ label: 'Last Modified', value: maxDate ? new Date(maxDate).toLocaleString() : 'Never' },
				{ label: 'Folders', value: folders.length.toString() },
				{ label: 'Lists', value: lists.length.toString() },
				{ label: 'Todos', value: todosCount.toString() },
				{ label: 'Notes', value: notesCount.toString() },
				{ label: 'Headings', value: headingsCount.toString() },
			];
		} catch (e) {
			// Yjs might not be fully initialized yet
			return [{ label: 'Error', value: 'Sync data unavailable' }];
		}
	})() : []);

</script>

<button class="badge" style="--dot:{color[status]}" onclick={() => showDialog = true} aria-label="Show sync info" title="Sync: {status}">
	<span class="dot"></span>
</button>

{#if showDialog}
	<InfoDialog
		title="Sync Information"
		rows={statsRows}
		onClose={() => showDialog = false}
	/>
{/if}

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--text2);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		outline: none;
	}
	.badge:hover, .badge:focus-visible {
		color: var(--text);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--dot);
	}
</style>
