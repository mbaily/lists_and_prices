<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { renderDokuWiki, slugifyWikiPage } from '$lib/wiki/dokuwiki';
	import { readWikiPages } from '$lib/wiki/data';
	import { getDoc, getItems, getLists, getFolders } from '$lib/yjsStore.svelte';

	let {
		pageId,
		initialTitle = '',
		initialContent = '',
		readOnly = false,
		onSave,
		onClose
	}: {
		pageId: string;
		initialTitle?: string;
		initialContent?: string;
		readOnly?: boolean;
		onSave: (data: { id: string; title: string; content: string; summary: string; isMinor: boolean }) => void;
		onClose: () => void;
	} = $props();

	let title = $state(initialTitle || pageId);
	let content = $state(initialContent);
	let editSummary = $state('');
	let isMinor = $state(false);
	let isPreview = $state(false);
	let showConfirmCancel = $state(false);
	let showLinkModal = $state(false);
	let linkTab = $state<'wiki' | 'item' | 'list' | 'external'>('wiki');
	let linkSearch = $state('');

	let viewportHeight = $state('100vh');
	let viewportTop = $state('0px');
	let textareaEl: HTMLTextAreaElement | null = null;

	const isDirty = $derived(content !== initialContent || title !== (initialTitle || pageId));

	// Responsive visual viewport for mobile keyboards
	$effect(() => {
		const updateHeight = () => {
			if (window.visualViewport) {
				viewportHeight = `${window.visualViewport.height}px`;
				viewportTop = `${window.visualViewport.offsetTop}px`;
			} else {
				viewportHeight = `${window.innerHeight}px`;
				viewportTop = `0px`;
			}
		};

		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', updateHeight);
			window.visualViewport.addEventListener('scroll', updateHeight);
		} else {
			window.addEventListener('resize', updateHeight);
		}

		updateHeight();

		return () => {
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', updateHeight);
				window.visualViewport.removeEventListener('scroll', updateHeight);
			} else {
				window.removeEventListener('resize', updateHeight);
			}
		};
	});

	// Textarea manipulation helpers
	function wrapSelection(before: string, after: string, placeholder = 'text') {
		if (!textareaEl) return;
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		const selectedText = content.slice(start, end);
		const replacement = selectedText ? `${before}${selectedText}${after}` : `${before}${placeholder}${after}`;
		
		content = content.slice(0, start) + replacement + content.slice(end);

		// Restore focus and selection
		requestAnimationFrame(() => {
			if (!textareaEl) return;
			textareaEl.focus();
			const newCursorPos = selectedText ? start + replacement.length : start + before.length + placeholder.length;
			textareaEl.setSelectionRange(
				selectedText ? start + replacement.length : start + before.length,
				newCursorPos
			);
		});
	}

	function insertPrefix(prefix: string) {
		if (!textareaEl) return;
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		
		// Find start of line
		const lineStart = content.lastIndexOf('\n', start - 1) + 1;
		content = content.slice(0, lineStart) + prefix + content.slice(lineStart);

		requestAnimationFrame(() => {
			if (!textareaEl) return;
			textareaEl.focus();
			const newPos = start + prefix.length;
			textareaEl.setSelectionRange(newPos, end + prefix.length);
		});
	}

	function insertSnippet(snippet: string) {
		if (!textareaEl) return;
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		content = content.slice(0, start) + snippet + content.slice(end);
		
		requestAnimationFrame(() => {
			if (!textareaEl) return;
			textareaEl.focus();
			const pos = start + snippet.length;
			textareaEl.setSelectionRange(pos, pos);
		});
	}

	function handleSave() {
		if (readOnly) return;
		onSave({
			id: pageId,
			title: title.trim() || pageId,
			content,
			summary: editSummary.trim(),
			isMinor
		});
	}

	function requestCancel() {
		if (!readOnly && isDirty) {
			showConfirmCancel = true;
			return;
		}
		onClose();
	}

	// Entities for Link modal
	function getAvailableWikiPages() {
		try {
			return readWikiPages(getDoc()).filter((p) => p.id !== pageId);
		} catch {
			return [];
		}
	}

	function getAvailableItems() {
		try {
			const items = getItems(getDoc());
			const list: { id: string; name: string; isNote: boolean }[] = [];
			items.forEach((m) => {
				const id = m.get('id') as string;
				const name = (m.get('name') as string) || '';
				const isNote = Boolean(m.get('isNote'));
				if (name.trim()) list.push({ id, name, isNote });
			});
			return list;
		} catch {
			return [];
		}
	}

	function getAvailableLists() {
		try {
			const lists = getLists(getDoc());
			const out: { id: string; name: string }[] = [];
			lists.forEach((m) => {
				out.push({ id: m.get('id') as string, name: (m.get('name') as string) || 'Untitled List' });
			});
			return out;
		} catch {
			return [];
		}
	}

	function insertWikiLink(targetSlug: string, label?: string) {
		const text = label ? `[[${targetSlug}|${label}]]` : `[[${targetSlug}]]`;
		insertSnippet(text);
		showLinkModal = false;
	}

	function insertEntityLink(type: 'item' | 'list', id: string, name: string) {
		// Clean hashtags or existing brackets from name
		const cleanName = name.replace(/#\w+/g, '').replace(/\[\[.*?\]\]/g, '').trim();
		const text = `[[${type}:${id}|${cleanName || id}]]`;
		insertSnippet(text);
		showLinkModal = false;
	}

	function insertCustomLink() {
		if (!linkSearch.trim()) return;
		if (linkTab === 'external') {
			const url = linkSearch.trim().startsWith('http') ? linkSearch.trim() : `https://${linkSearch.trim()}`;
			insertSnippet(`[[${url}|${linkSearch.trim()}]]`);
		} else {
			const raw = linkSearch.trim();
			const target = (raw.startsWith('.') || raw.startsWith(':')) ? raw : slugifyWikiPage(raw);
			insertSnippet(`[[${target}|${raw}]]`);
		}
		showLinkModal = false;
		linkSearch = '';
	}
</script>

<div class="fullscreen-editor-overlay">
	<div class="visual-viewport-container" style="height: {viewportHeight}; top: {viewportTop};">
		<!-- Header -->
		<div class="editor-header">
			<div class="editor-toolbar">
				<button
					type="button"
					class="hdr-btn cancel-btn"
					onclick={requestCancel}
					title="Cancel"
					aria-label="Cancel"
				>
					✕
				</button>
				<button
					type="button"
					class="hdr-btn preview-btn"
					class:active={isPreview}
					onclick={() => (isPreview = !isPreview)}
					title={isPreview ? 'Back to Editor' : 'Preview'}
					aria-label={isPreview ? 'Back to Editor' : 'Preview'}
				>
					{isPreview ? '✏️' : '👁️'}
				</button>
				{#if !readOnly}
					<button
						type="button"
						class="hdr-btn save-btn"
						onclick={handleSave}
						title="Save"
						aria-label="Save"
					>
						💾
					</button>
				{/if}
			</div>

			<div class="editor-title-wrap">
				<input
					type="text"
					class="title-input"
					bind:value={title}
					placeholder="Page Title"
					disabled={readOnly}
				/>
				<span class="page-badge" title="Slug: {pageId}">wiki:{pageId}</span>
			</div>
		</div>

		<!-- DokuWiki Toolbar (visible in Edit mode) -->
		{#if !isPreview && !readOnly}
			<div class="wiki-toolbar" role="toolbar" aria-label="DokuWiki formatting toolbar">
				<div class="btn-group">
					<button type="button" class="tb-btn" onclick={() => wrapSelection('**', '**', 'bold text')} title="Bold (**text**)"><strong>B</strong></button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('//', '//', 'italic text')} title="Italic (//text//)"><em>I</em></button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('__', '__', 'underlined text')} title="Underline (__text__)"><u>U</u></button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('<del>', '</del>', 'strike text')} title="Strikethrough (<del>text</del>)"><s>S</s></button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection("''", "''", 'code')} title="Monospace (''code'')"><code>''</code></button>
				</div>
				<div class="toolbar-divider"></div>
				<div class="btn-group">
					<button type="button" class="tb-btn" onclick={() => wrapSelection('====== ', ' ======', 'Document Title')} title="Heading 1 (====== H1 ======)">H1</button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('===== ', ' =====', 'Section Heading')} title="Heading 2 (===== H2 =====)">H2</button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('==== ', ' ====', 'Subsection Heading')} title="Heading 3 (==== H3 ====)">H3</button>
				</div>
				<div class="toolbar-divider"></div>
				<div class="btn-group">
					<button type="button" class="tb-btn" onclick={() => insertPrefix('  * ')} title="Unordered list (  * item)">• List</button>
					<button type="button" class="tb-btn" onclick={() => insertPrefix('  - ')} title="Ordered list (  - item)">1. List</button>
					<button type="button" class="tb-btn" onclick={() => insertSnippet('\n^ Header 1 ^ Header 2 ^\n| Row 1 Col 1 | Row 1 Col 2 |\n')} title="Table template">⊞ Table</button>
					<button type="button" class="tb-btn" onclick={() => insertSnippet('\n----\n')} title="Horizontal rule (----)">— Line</button>
					<button type="button" class="tb-btn" onclick={() => wrapSelection('<code>\n', '\n</code>', 'code block')} title="Code block (&lt;code&gt;...&lt;/code&gt;)">[code]</button>
				</div>
				<div class="toolbar-divider"></div>
				<div class="btn-group">
					<button type="button" class="tb-btn tb-btn-link" onclick={() => { showLinkModal = true; linkSearch = ''; }} title="Insert link to Wiki page, Todo, Subnote or List">
						🔗 Link
					</button>
				</div>
			</div>
		{/if}

		<!-- Editor / Preview Area -->
		<div class="editor-body">
			{#if isPreview}
				<div class="preview-scroll">
					<div class="preview-card wiki-rendered">
						<h1 class="wiki-heading">{title || pageId}</h1>
						{@html renderDokuWiki(content, { currentSlug: pageId })}
					</div>
				</div>
			{:else}
				<textarea
					bind:this={textareaEl}
					class="monospace-textarea"
					bind:value={content}
					placeholder="Enter DokuWiki markup here...&#10;&#10;====== Page Title ======&#10;Write text with **bold**, //italic//, [[links]], etc."
					disabled={readOnly}
					spellcheck="false"
				></textarea>
			{/if}
		</div>

		<!-- Bottom Bar: Edit summary & Minor changes -->
		{#if !readOnly}
			<div class="editor-footer">
				<div class="footer-left">
					<input
						type="text"
						class="summary-input"
						bind:value={editSummary}
						placeholder="Edit summary (briefly describe your changes)"
					/>
				</div>
				<div class="footer-right">
					<label class="minor-label">
						<input type="checkbox" bind:checked={isMinor} />
						<span>Minor changes</span>
					</label>
				</div>
			</div>
		{/if}
	</div>

	<!-- Unsaved changes confirmation dialog -->
	{#if showConfirmCancel}
		<ConfirmDialog
			message="You have unsaved changes. Are you sure you want to discard them?"
			confirmLabel="Discard Changes"
			cancelLabel="Keep Editing"
			isDanger={true}
			onConfirm={() => {
				showConfirmCancel = false;
				onClose();
			}}
			onCancel={() => (showConfirmCancel = false)}
		/>
	{/if}

	<!-- Insert Link Modal -->
	{#if showLinkModal}
		<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showLinkModal = false; }}>
			<div class="link-modal">
				<div class="modal-header">
					<h3>Insert Link</h3>
					<button type="button" class="modal-close-btn" onclick={() => (showLinkModal = false)}>✕</button>
				</div>
				<div class="modal-tabs">
					<button type="button" class="tab-btn" class:active={linkTab === 'wiki'} onclick={() => (linkTab = 'wiki')}>📖 Wiki Page</button>
					<button type="button" class="tab-btn" class:active={linkTab === 'item'} onclick={() => (linkTab = 'item')}>☑️ Todo / Note</button>
					<button type="button" class="tab-btn" class:active={linkTab === 'list'} onclick={() => (linkTab = 'list')}>📋 List</button>
					<button type="button" class="tab-btn" class:active={linkTab === 'external'} onclick={() => (linkTab = 'external')}>🌐 URL</button>
				</div>
				<div class="modal-search">
					<input
						type="text"
						class="modal-search-input"
						placeholder={linkTab === 'external' ? 'Enter URL (https://...)' : 'Search or type name...'}
						bind:value={linkSearch}
						onkeydown={(e) => { if (e.key === 'Enter') insertCustomLink(); }}
					/>
					<button type="button" class="modal-insert-btn" onclick={insertCustomLink}>Insert</button>
				</div>
				<div class="modal-list">
					{#if linkTab === 'wiki'}
						{#each getAvailableWikiPages().filter(p => !linkSearch || p.title.toLowerCase().includes(linkSearch.toLowerCase()) || p.id.includes(linkSearch.toLowerCase())) as p}
							<button type="button" class="modal-item" onclick={() => insertWikiLink(p.id, p.title)}>
								<span class="m-icon">📖</span>
								<span class="m-title">{p.title}</span>
								<span class="m-sub">({p.id})</span>
							</button>
						{/each}
					{:else if linkTab === 'item'}
						{#each getAvailableItems().filter(i => !linkSearch || i.name.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 30) as item}
							<button type="button" class="modal-item" onclick={() => insertEntityLink('item', item.id, item.name)}>
								<span class="m-icon">{item.isNote ? '📝' : '☑️'}</span>
								<span class="m-title">{item.name}</span>
							</button>
						{/each}
					{:else if linkTab === 'list'}
						{#each getAvailableLists().filter(l => !linkSearch || l.name.toLowerCase().includes(linkSearch.toLowerCase())) as list}
							<button type="button" class="modal-item" onclick={() => insertEntityLink('list', list.id, list.name)}>
								<span class="m-icon">📋</span>
								<span class="m-title">{list.name}</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.fullscreen-editor-overlay {
		position: fixed;
		inset: 0;
		background: var(--bg);
		z-index: 9999;
		overscroll-behavior: none;
	}
	.visual-viewport-container {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	.editor-header {
		display: flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		min-height: 52px;
		gap: 0.75rem;
	}
	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}
	.editor-title-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}
	.title-input {
		flex: 1;
		min-width: 0;
		font-size: 1.15rem;
		font-weight: 600;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		background: transparent;
		color: var(--text);
		outline: none;
		transition: border-color 0.15s, background-color 0.15s;
	}
	.title-input:hover {
		border-color: var(--border);
		background: var(--bg);
	}
	.title-input:focus {
		border-color: var(--accent);
		background: var(--bg);
	}
	.page-badge {
		font-size: 0.8rem;
		font-family: monospace;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		background: var(--bg3);
		color: var(--text2);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.hdr-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 1.05rem;
		min-width: 32px;
		height: 32px;
		padding: 0 0.4rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
	}
	.hdr-btn:hover {
		background: var(--bg3);
		border-color: var(--accent);
		transform: scale(1.05);
	}
	.hdr-btn:active {
		transform: scale(0.96);
	}
	.preview-btn.active {
		background: var(--bg3);
		border-color: var(--accent);
		color: var(--accent);
	}
	.save-btn {
		background: #6366f1;
		color: #fff;
		border-color: #6366f1;
	}
	.save-btn:hover {
		background: #4f46e5;
		border-color: #4f46e5;
	}
	@media (max-width: 640px) {
		.editor-header {
			flex-direction: column;
			align-items: stretch;
			padding: 0.4rem 0.5rem;
			gap: 0.35rem;
			min-height: auto;
		}
		.editor-toolbar {
			width: 100%;
		}
		.editor-title-wrap {
			width: 100%;
			border-top: 1px solid var(--border);
			padding-top: 0.25rem;
		}
		.title-input {
			font-size: 1rem;
		}
	}

	.wiki-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.8rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
	}
	.btn-group {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.toolbar-divider {
		width: 1px;
		height: 20px;
		background: var(--border);
		margin: 0 0.3rem;
	}
	.tb-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		font-size: 0.85rem;
		padding: 0.2rem 0.45rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		min-height: 26px;
	}
	.tb-btn:hover {
		background: var(--bg3);
	}
	.tb-btn-link {
		font-weight: 600;
		color: var(--accent);
		background: var(--bg);
	}

	.editor-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
		background: var(--bg);
	}
	.monospace-textarea {
		flex: 1;
		width: 100%;
		border: none;
		padding: 1rem;
		resize: none;
		outline: none;
		background: var(--bg);
		color: var(--text);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
		font-size: 0.95rem;
		line-height: 1.55;
		tab-size: 2;
	}
	.preview-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
	}
	.preview-card {
		max-width: 800px;
		margin: 0 auto;
	}

	.editor-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--border);
		background: var(--bg2);
	}
	.footer-left {
		flex: 1;
	}
	.summary-input {
		width: 100%;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--text);
		font-size: 0.9rem;
	}
	.minor-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.88rem;
		color: var(--text2);
		cursor: pointer;
		white-space: nowrap;
	}

	/* Modal Backdrop & Dialog */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.link-modal {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		width: 100%;
		max-width: 480px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 30px rgba(0,0,0,0.3);
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.modal-header h3 {
		margin: 0;
		font-size: 1.1rem;
	}
	.modal-close-btn {
		background: none;
		border: none;
		color: var(--text2);
		font-size: 1.1rem;
		cursor: pointer;
	}
	.modal-tabs {
		display: flex;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
	}
	.tab-btn {
		flex: 1;
		background: none;
		border: none;
		padding: 0.5rem;
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--text2);
		border-bottom: 2px solid transparent;
	}
	.tab-btn.active {
		color: var(--accent);
		font-weight: 600;
		border-bottom-color: var(--accent);
		background: var(--bg);
	}
	.modal-search {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
	}
	.modal-search-input {
		flex: 1;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--text);
	}
	.modal-insert-btn {
		background: #6366f1;
		color: #fff;
		border: none;
		border-radius: 4px;
		padding: 0.4rem 0.8rem;
		cursor: pointer;
		font-weight: 600;
	}
	.modal-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 1rem;
		max-height: 250px;
	}
	.modal-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.5rem;
		border: none;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.9rem;
	}
	.modal-item:hover {
		background: var(--bg2);
	}
	.m-icon {
		font-size: 1rem;
	}
	.m-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.m-sub {
		color: var(--text2);
		font-size: 0.8rem;
	}

	/* Rendered wiki preview styling */
	:global(.wiki-rendered) {
		line-height: 1.6;
		color: var(--text);
	}
	:global(.wiki-rendered h1.wiki-heading) {
		font-size: 1.75rem;
		margin: 1.2rem 0 0.6rem;
		border-bottom: 2px solid var(--border);
		padding-bottom: 0.3rem;
	}
	:global(.wiki-rendered h2.wiki-heading) {
		font-size: 1.4rem;
		margin: 1rem 0 0.5rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.2rem;
	}
	:global(.wiki-rendered h3.wiki-heading) {
		font-size: 1.2rem;
		margin: 0.8rem 0 0.4rem;
	}
	:global(.wiki-rendered h4.wiki-heading) {
		font-size: 1.05rem;
		margin: 0.6rem 0 0.3rem;
	}
	:global(.wiki-rendered h5.wiki-heading) {
		font-size: 0.95rem;
		margin: 0.5rem 0 0.2rem;
	}
	:global(.wiki-rendered p) {
		margin: 0.6rem 0;
	}
	:global(.wiki-rendered hr.wiki-hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.2rem 0;
	}
	:global(.wiki-rendered pre.wiki-code-block) {
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.75rem 1rem;
		overflow-x: auto;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.9rem;
	}
	:global(.wiki-rendered code.wiki-inline-code) {
		background: var(--bg2);
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.9em;
	}
	:global(.wiki-rendered blockquote) {
		margin: 0.75rem 0;
		padding: 0.4rem 1rem;
		border-left: 4px solid var(--accent);
		background: var(--bg2);
		color: var(--text2);
	}
	:global(.wiki-rendered table.wiki-table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.8rem 0;
	}
	:global(.wiki-rendered table.wiki-table th),
	:global(.wiki-rendered table.wiki-table td) {
		border: 1px solid var(--border);
		padding: 0.4rem 0.75rem;
		text-align: left;
	}
	:global(.wiki-rendered table.wiki-table th) {
		background: var(--bg2);
		font-weight: 600;
	}
	:global(.wiki-rendered a.wiki-link) {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
	}
	:global(.wiki-rendered a.wiki-link:hover) {
		text-decoration: underline;
	}
	:global(.wiki-rendered a.wiki-link-missing) {
		color: #ef4444;
		text-decoration: underline dotted;
	}
	:global(.wiki-rendered a.wiki-external-link) {
		color: #3b82f6;
		text-decoration: underline;
	}
	:global(.wiki-ref-icon) {
		font-size: 0.9em;
		margin-right: 0.2rem;
	}
</style>

