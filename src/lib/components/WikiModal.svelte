<script lang="ts">
	import { getDoc, getMutableDoc, docState, commitState } from '$lib/yjsStore.svelte';
	import { readWikiPage, readWikiPages, saveWikiPage, deleteWikiPage, findWikiBacklinks, type WikiPage, type WikiRevision } from '$lib/wiki/data';
	import { renderDokuWiki, slugifyWikiPage } from '$lib/wiki/dokuwiki';
	import WikiEditor from './WikiEditor.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let {
		initialPageId = 'start',
		onClose,
		onNavigateToList,
		onNavigateToItem,
		onNavigateToFolder
	}: {
		initialPageId?: string;
		onClose: () => void;
		onNavigateToList?: (listId: string) => void;
		onNavigateToItem?: (itemId: string, listId?: string) => void;
		onNavigateToFolder?: (folderId: string) => void;
	} = $props();

	let currentPageId = $state(slugifyWikiPage(initialPageId));
	let history = $state<string[]>([slugifyWikiPage(initialPageId)]);
	let isEditing = $state(false);
	let showIndex = $state(false);
	let showHistory = $state(false);
	let selectedRevision = $state<WikiRevision | null>(null);
	let showRestoreConfirm = $state(false);
	let revisionToRestore = $state<WikiRevision | null>(null);
	let indexSearch = $state('');
	let showNewPageModal = $state(false);
	let newPageTitle = $state('');
	let showDeleteConfirm = $state(false);
	let copyFeedback = $state(false);

	let viewportHeight = $state('100vh');
	let viewportTop = $state('0px');

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

	// Reactive read of wiki pages and current page from Y.Doc
	const allPages = $derived.by(() => {
		void docState.version;
		try {
			return readWikiPages(getDoc());
		} catch {
			return [];
		}
	});

	const currentPage = $derived.by(() => {
		void docState.version;
		try {
			return readWikiPage(getDoc(), currentPageId);
		} catch {
			return null;
		}
	});

	const backlinks = $derived.by(() => {
		void docState.version;
		try {
			return findWikiBacklinks(getDoc(), currentPageId);
		} catch {
			return { wikiPages: [], items: [] };
		}
	});

	// Rendered HTML of the current page
	const renderedHtml = $derived.by(() => {
		if (!currentPage) return '';
		return renderDokuWiki(currentPage.content, {
			resolveWikiTitle: (slug) => allPages.find((p) => p.id === slug)?.title,
			pageExists: (slug) => allPages.some((p) => p.id === slug)
		});
	});

	const sortedRevisions = $derived((currentPage?.revisions ?? []).slice().reverse());

	function navigateToPage(id: string) {
		const slug = slugifyWikiPage(id);
		if (slug !== currentPageId) {
			currentPageId = slug;
			history = [...history, slug];
		}
		showIndex = false;
		showHistory = false;
		selectedRevision = null;
	}

	function handleBack() {
		if (history.length > 1) {
			const nextHistory = [...history];
			nextHistory.pop();
			const prevPage = nextHistory[nextHistory.length - 1];
			history = nextHistory;
			currentPageId = prevPage;
		} else {
			onClose();
		}
	}

	function handleContentClick(e: MouseEvent) {
		const target = (e.target as HTMLElement).closest('a');
		if (!target) return;

		// Wiki link
		if (target.classList.contains('wiki-link')) {
			e.preventDefault();
			const wikiSlug = target.getAttribute('data-wiki-page');
			if (wikiSlug) {
				navigateToPage(wikiSlug);
				return;
			}

			// Entity ref links
			const refType = target.getAttribute('data-ref-type');
			const refId = target.getAttribute('data-ref-id');
			if (refType && refId) {
				if (refType === 'item') {
					if (onNavigateToItem) {
						onClose();
						onNavigateToItem(refId);
					}
				} else if (refType === 'list') {
					if (onNavigateToList) {
						onClose();
						onNavigateToList(refId);
					}
				} else if (refType === 'folder') {
					if (onNavigateToFolder) {
						onClose();
						onNavigateToFolder(refId);
					}
				}
			}
		}
	}

	function handleSavePage(data: { id: string; title: string; content: string; summary: string; isMinor: boolean }) {
		if (commitState.isHistorical) return;
		saveWikiPage(getMutableDoc(), data.id, {
			title: data.title,
			content: data.content,
			summary: data.summary,
			isMinor: data.isMinor
		});
		isEditing = false;
	}

	function handleDeleteCurrentPage() {
		if (commitState.isHistorical || !currentPage) return;
		deleteWikiPage(getMutableDoc(), currentPage.id);
		showDeleteConfirm = false;
		navigateToPage('start');
	}

	function createNewPage() {
		if (!newPageTitle.trim()) return;
		const slug = slugifyWikiPage(newPageTitle);
		currentPageId = slug;
		history = [...history, slug];
		newPageTitle = '';
		showNewPageModal = false;
		showIndex = false;
		isEditing = true;
	}

	function copyLink() {
		const pageTitle = currentPage?.title || currentPageId;
		const text = `[[wiki:${currentPageId}|${pageTitle}]]`;
		navigator.clipboard.writeText(text).catch(() => {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		});
		copyFeedback = true;
		setTimeout(() => { copyFeedback = false; }, 2000);
	}

	function formatDate(isoStr: string): string {
		try {
			const d = new Date(isoStr);
			return d.toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return isoStr;
		}
	}
</script>

<div class="wiki-modal-overlay">
	<div class="visual-viewport-container" style="height: {viewportHeight}; top: {viewportTop};">
		<!-- Navigation & Action Header -->
		<header class="wiki-header">
			<div class="hdr-left">
				<button type="button" class="hdr-btn" onclick={handleBack} title={history.length > 1 ? 'Go Back' : 'Close Wiki'}>
					{history.length > 1 ? '← Back' : '✕ Close'}
				</button>
				<button type="button" class="hdr-btn index-toggle-btn" class:active={showIndex} onclick={() => (showIndex = !showIndex)} title="All Wiki Pages">
					📑 Pages
				</button>
			</div>

			<div class="hdr-title" title="Slug: {currentPageId}">
				<span class="wiki-icon">📖</span>
				<span class="title-text">{currentPage?.title || currentPageId}</span>
			</div>

			<div class="hdr-right">
				{#if !showIndex && !showHistory && !commitState.isHistorical}
					<button type="button" class="hdr-btn" onclick={() => (isEditing = true)} title="Edit this page">
						✏️ Edit
					</button>
					{#if currentPage}
						<button
							type="button"
							class="hdr-btn history-toggle-btn"
							onclick={() => { showHistory = true; selectedRevision = null; }}
							title="View Page Revision History"
						>
							📜 History{currentPage.revisions?.length ? ` (${currentPage.revisions.length})` : ''}
						</button>
					{/if}
					<button type="button" class="hdr-btn" onclick={copyLink} title="Copy link to this wiki page">
						{copyFeedback ? '✓ Copied' : '🔗 Link'}
					</button>
					{#if currentPage && currentPageId !== 'start'}
						<button type="button" class="hdr-btn delete-btn" onclick={() => (showDeleteConfirm = true)} title="Delete page">
							🗑️
						</button>
					{/if}
				{:else if showHistory}
					<button type="button" class="hdr-btn" onclick={() => { showHistory = false; selectedRevision = null; }}>
						← Current Version
					</button>
				{/if}
				<button type="button" class="hdr-btn new-page-btn" onclick={() => (showNewPageModal = true)} title="Create New Page">
					➕ New
				</button>
			</div>
		</header>

		<!-- Main Area -->
		<div class="wiki-body">
			{#if showIndex}
				<!-- All Pages Index View -->
				<div class="wiki-index-pane">
					<div class="index-search-bar">
						<input
							type="text"
							class="index-search-input"
							placeholder="Search pages by title or slug..."
							bind:value={indexSearch}
						/>
					</div>
					<div class="index-page-list">
						{#if allPages.length === 0}
							<div class="empty-pages-msg">
								<p>No wiki pages created yet.</p>
								<button type="button" class="primary-btn" onclick={() => { navigateToPage('start'); isEditing = true; showIndex = false; }}>
									Create Start Page
								</button>
							</div>
						{:else}
							{#each allPages.filter(p => !indexSearch || p.title.toLowerCase().includes(indexSearch.toLowerCase()) || p.id.includes(indexSearch.toLowerCase())) as p}
								<button type="button" class="index-page-item" class:current={p.id === currentPageId} onclick={() => navigateToPage(p.id)}>
									<div class="item-main">
										<span class="page-title">{p.title}</span>
										<span class="page-slug">({p.id})</span>
									</div>
									<div class="item-meta">
										<span class="updated-time">{formatDate(p.updatedAt)}</span>
										{#if p.lastSummary}
											<span class="item-summary">— {p.lastSummary}</span>
										{/if}
									</div>
								</button>
							{/each}
						{/if}
					</div>
				</div>
			{:else if showHistory}
				<!-- Revision History View -->
				<div class="wiki-history-pane">
					{#if selectedRevision}
						<div class="rev-preview-header">
							<div class="rev-banner">
								<span>Revision from <strong>{formatDate(selectedRevision.timestamp)}</strong></span>
								{#if selectedRevision.summary}
									<span class="rev-banner-summary">"{selectedRevision.summary}"</span>
								{/if}
								{#if selectedRevision.isMinor}
									<span class="minor-badge">minor</span>
								{/if}
							</div>
							<div class="rev-preview-actions">
								{#if !commitState.isHistorical}
									<button
										type="button"
										class="primary-btn restore-btn"
										onclick={() => { revisionToRestore = selectedRevision; showRestoreConfirm = true; }}
									>
										↩️ Restore This Version
									</button>
								{/if}
								<button type="button" class="hdr-btn" onclick={() => (selectedRevision = null)}>
									✕ Close Preview
								</button>
							</div>
						</div>
						<div class="wiki-content-scroll">
							<div class="wiki-article-card wiki-rendered">
								<h1 class="page-main-heading">{selectedRevision.title}</h1>
								{@html renderDokuWiki(selectedRevision.content)}
							</div>
						</div>
					{:else}
						<div class="history-list-header">
							<h2>Revision History for "{currentPage?.title || currentPageId}"</h2>
							<p class="history-hint">Revisions are automatically preserved and thinned over time to keep history compact.</p>
						</div>
						<div class="history-page-list">
							<!-- Current live version -->
							<div class="history-item current-rev">
								<div class="rev-main">
									<span class="rev-badge-current">CURRENT</span>
									<span class="rev-time">{formatDate(currentPage?.updatedAt ?? '')}</span>
									{#if currentPage?.isMinor}<span class="minor-badge">minor</span>{/if}
								</div>
								<div class="rev-meta">
									<span class="rev-summary">{currentPage?.lastSummary ? `"${currentPage.lastSummary}"` : '(Current active version)'}</span>
								</div>
							</div>

							{#if sortedRevisions.length === 0}
								<div class="empty-revs-msg">
									<p>No earlier revisions recorded yet for this page.</p>
								</div>
							{:else}
								{#each sortedRevisions as rev, i}
									<div class="history-item">
										<div class="rev-main">
											<span class="rev-index">#{sortedRevisions.length - i}</span>
											<span class="rev-time">{formatDate(rev.timestamp)}</span>
											{#if rev.isMinor}<span class="minor-badge">minor</span>{/if}
										</div>
										<div class="rev-meta">
											<span class="rev-summary">{rev.summary ? `"${rev.summary}"` : '(No edit summary)'}</span>
										</div>
										<div class="rev-actions">
											<button type="button" class="rev-btn view-btn" onclick={() => (selectedRevision = rev)}>
												👁️ View
											</button>
											{#if !commitState.isHistorical}
												<button
													type="button"
													class="rev-btn restore-btn"
													onclick={() => { revisionToRestore = rev; showRestoreConfirm = true; }}
												>
													↩️ Restore
												</button>
											{/if}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<!-- Current Page Content View -->
				<div class="wiki-content-scroll" onclick={handleContentClick}>
					<div class="wiki-article-card">
						{#if currentPage}
							<!-- Page Title & Meta -->
							<div class="article-meta-header">
								<h1 class="page-main-heading">{currentPage.title}</h1>
								<div class="page-metadata-bar">
									<span class="page-slug-badge">{currentPage.id}</span>
									<span class="meta-dot">•</span>
									<span class="meta-time">Updated {formatDate(currentPage.updatedAt)}</span>
									{#if currentPage.lastSummary}
										<span class="meta-dot">•</span>
										<span class="meta-summary">"{currentPage.lastSummary}"</span>
									{/if}
									{#if currentPage.isMinor}
										<span class="minor-badge">minor</span>
									{/if}
								</div>
							</div>

							<!-- Rendered DokuWiki HTML -->
							<div class="wiki-rendered-body wiki-rendered">
								{@html renderedHtml}
							</div>

							<!-- Backlinks ("What links here") -->
							{#if backlinks.wikiPages.length > 0 || backlinks.items.length > 0}
								<div class="backlinks-section">
									<h3 class="backlinks-heading">🔗 What links here</h3>
									{#if backlinks.wikiPages.length > 0}
										<div class="backlink-group">
											<span class="group-label">Wiki pages:</span>
											<div class="backlink-chips">
												{#each backlinks.wikiPages as wp}
													<button type="button" class="backlink-chip wiki-chip" onclick={() => navigateToPage(wp.id)}>
														📖 {wp.title}
													</button>
												{/each}
											</div>
										</div>
									{/if}
									{#if backlinks.items.length > 0}
										<div class="backlink-group">
											<span class="group-label">Todos & Notes:</span>
											<div class="backlink-chips">
												{#each backlinks.items as item}
													<button
														type="button"
														class="backlink-chip item-chip"
														onclick={() => {
															if (onNavigateToItem) {
																onClose();
																onNavigateToItem(item.id, item.listId);
															}
														}}
													>
														{item.isNote ? '📝' : '☑️'} {item.name.replace(/\[\[wiki:.*?\]\]/g, '').trim() || item.id}
													</button>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							{/if}
						{:else}
							<!-- Page Does Not Exist State -->
							<div class="empty-page-state">
								<h2>Topic does not exist yet</h2>
								<p>There is currently no wiki page for <code>{currentPageId}</code>.</p>
								{#if !commitState.isHistorical}
									<button
										type="button"
										class="primary-btn create-page-btn"
										onclick={() => (isEditing = true)}
									>
										✏️ Create "{currentPageId}" Page
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Full-screen DokuWiki Editor -->
	{#if isEditing}
		<WikiEditor
			pageId={currentPageId}
			initialTitle={currentPage?.title || (currentPageId === 'start' ? 'Start Page' : currentPageId)}
			initialContent={currentPage?.content || `====== ${currentPage?.title || currentPageId} ======\n\nWrite your content here...`}
			readOnly={commitState.isHistorical}
			onSave={handleSavePage}
			onClose={() => (isEditing = false)}
		/>
	{/if}

	<!-- New Page Dialog -->
	{#if showNewPageModal}
		<div class="dialog-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showNewPageModal = false; }}>
			<div class="dialog-box">
				<h3>Create New Wiki Page</h3>
				<p>Enter a title for the new page:</p>
				<input
					type="text"
					class="dialog-input"
					placeholder="e.g. Project Architecture, Meeting Notes"
					bind:value={newPageTitle}
					onkeydown={(e) => { if (e.key === 'Enter') createNewPage(); }}
				/>
				<div class="dialog-actions">
					<button type="button" class="cancel-btn" onclick={() => (showNewPageModal = false)}>Cancel</button>
					<button type="button" class="confirm-btn" onclick={createNewPage} disabled={!newPageTitle.trim()}>Create</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Delete Page Confirm Dialog -->
	{#if showDeleteConfirm}
		<ConfirmDialog
			message={`Are you sure you want to delete the wiki page "${currentPage?.title || currentPageId}"?`}
			confirmLabel="Delete Page"
			cancelLabel="Keep Page"
			isDanger={true}
			onConfirm={handleDeleteCurrentPage}
			onCancel={() => (showDeleteConfirm = false)}
		/>
	{/if}

	<!-- Restore Revision Confirm Dialog -->
	{#if showRestoreConfirm && revisionToRestore}
		<ConfirmDialog
			message={`Are you sure you want to restore "${currentPage?.title || currentPageId}" to the revision from ${formatDate(revisionToRestore.timestamp)}?`}
			confirmLabel="Restore Revision"
			cancelLabel="Cancel"
			isDanger={false}
			onConfirm={() => {
				if (revisionToRestore) {
					handleSavePage({
						id: currentPageId,
						title: revisionToRestore.title,
						content: revisionToRestore.content,
						summary: `Restored to revision from ${formatDate(revisionToRestore.timestamp)}`,
						isMinor: false
					});
				}
				showRestoreConfirm = false;
				revisionToRestore = null;
				showHistory = false;
				selectedRevision = null;
			}}
			onCancel={() => {
				showRestoreConfirm = false;
				revisionToRestore = null;
			}}
		/>
	{/if}
</div>

<style>
	.wiki-modal-overlay {
		position: fixed;
		inset: 0;
		background: var(--bg);
		z-index: 9998;
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
	.wiki-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		min-height: 52px;
	}
	.hdr-left, .hdr-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.hdr-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		font-size: 1.05rem;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wiki-icon {
		font-size: 1.15rem;
	}
	.title-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hdr-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 0.9rem;
		padding: 0.35rem 0.65rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.hdr-btn:hover {
		background: var(--bg3);
	}
	.index-toggle-btn.active {
		background: var(--bg3);
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	.new-page-btn {
		background: #6366f1;
		color: #fff;
		border-color: #6366f1;
		font-weight: 600;
	}
	.new-page-btn:hover {
		background: #4f46e5;
	}
	.delete-btn {
		color: #ef4444;
	}

	.wiki-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg);
	}

	/* Index Pane */
	.wiki-index-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		overflow: hidden;
	}
	.index-search-bar {
		margin-bottom: 1rem;
	}
	.index-search-input {
		width: 100%;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		font-size: 1rem;
	}
	.index-page-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.index-page-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.index-page-item:hover {
		border-color: var(--accent);
	}
	.index-page-item.current {
		border-color: var(--accent);
		background: var(--bg3);
	}
	.item-main {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.page-title {
		font-weight: 600;
		font-size: 1.05rem;
	}
	.page-slug {
		font-size: 0.85rem;
		color: var(--text2);
		font-family: monospace;
	}
	.item-meta {
		font-size: 0.82rem;
		color: var(--text2);
	}
	.empty-pages-msg {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text2);
	}

	/* Article View */
	.wiki-content-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem 1rem;
	}
	.wiki-article-card {
		max-width: 820px;
		margin: 0 auto;
		padding-bottom: 4rem;
	}
	.article-meta-header {
		margin-bottom: 1.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	.page-main-heading {
		font-size: 2rem;
		margin: 0 0 0.5rem;
		font-weight: 700;
	}
	.page-metadata-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text2);
	}
	.page-slug-badge {
		font-family: monospace;
		background: var(--bg2);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		border: 1px solid var(--border);
	}
	.meta-dot {
		color: var(--text2);
	}
	.minor-badge {
		background: var(--bg3);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.75rem;
		text-transform: uppercase;
		font-weight: 600;
	}

	.wiki-rendered-body {
		min-height: 200px;
	}

	/* Backlinks */
	.backlinks-section {
		margin-top: 3rem;
		padding-top: 1.5rem;
		border-top: 2px dashed var(--border);
	}
	.backlinks-heading {
		font-size: 1.1rem;
		margin: 0 0 1rem;
		color: var(--text2);
	}
	.backlink-group {
		margin-bottom: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.group-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text2);
	}
	.backlink-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.backlink-chip {
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		padding: 0.3rem 0.6rem;
		font-size: 0.85rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.backlink-chip:hover {
		border-color: var(--accent);
		background: var(--bg3);
	}

	/* Empty page state */
	.empty-page-state {
		text-align: center;
		padding: 4rem 1rem;
	}
	.empty-page-state h2 {
		margin-bottom: 0.5rem;
	}
	.empty-page-state p {
		color: var(--text2);
		margin-bottom: 1.5rem;
	}
	.primary-btn {
		background: #6366f1;
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 0.6rem 1.2rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-btn:hover {
		background: #4f46e5;
	}

	/* Dialog */
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 10001;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.dialog-box {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 420px;
		box-shadow: 0 8px 30px rgba(0,0,0,0.3);
	}
	.dialog-box h3 {
		margin: 0 0 0.5rem;
	}
	.dialog-box p {
		margin: 0 0 1rem;
		color: var(--text2);
		font-size: 0.9rem;
	}
	.dialog-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--text);
		font-size: 1rem;
		margin-bottom: 1.2rem;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.dialog-actions button {
		padding: 0.45rem 0.9rem;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.dialog-actions .cancel-btn {
		background: none;
		border: 1px solid var(--border);
		color: var(--text);
	}
	.dialog-actions .confirm-btn {
		background: #6366f1;
		color: #fff;
		border: none;
		font-weight: 600;
	}

	/* History Pane */
	.wiki-history-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		overflow: hidden;
	}
	.history-list-header {
		margin-bottom: 1rem;
	}
	.history-list-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1.4rem;
	}
	.history-hint {
		font-size: 0.85rem;
		color: var(--text2);
		margin: 0;
	}
	.history-page-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-bottom: 2rem;
	}
	.history-item {
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.history-item.current-rev {
		border-color: var(--accent);
		background: var(--bg3);
	}
	.rev-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.rev-badge-current {
		background: var(--accent);
		color: #fff;
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		letter-spacing: 0.03em;
	}
	.rev-index {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text2);
		font-family: monospace;
	}
	.rev-time {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.rev-meta {
		font-size: 0.85rem;
		color: var(--text2);
	}
	.rev-summary {
		font-style: italic;
	}
	.rev-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.3rem;
	}
	.rev-btn {
		padding: 0.25rem 0.65rem;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.rev-btn:hover {
		background: var(--bg2);
		border-color: var(--accent);
	}
	.rev-btn.restore-btn {
		color: var(--accent);
		font-weight: 600;
	}
	.empty-revs-msg {
		text-align: center;
		padding: 2.5rem 1rem;
		color: var(--text2);
	}
	.rev-preview-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.rev-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.rev-banner-summary {
		color: var(--text2);
		font-style: italic;
	}
	.rev-preview-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.restore-btn {
		background: var(--accent);
		color: #fff;
		border: none;
		padding: 0.35rem 0.75rem;
		border-radius: 4px;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.restore-btn:hover {
		opacity: 0.9;
	}
</style>

