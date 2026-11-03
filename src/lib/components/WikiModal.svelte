<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getDoc, getMutableDoc, getItems, getLists, docState, commitState } from '$lib/yjsStore.svelte';
	import { readWikiPage, readWikiPages, saveWikiPage, deleteWikiPage, findWikiBacklinks, type WikiPage, type WikiRevision } from '$lib/wiki/data';
	import { renderDokuWiki, slugifyWikiPage } from '$lib/wiki/dokuwiki';
	import {
		getNamespace,
		getPageBaseName,
		getNamespaceSegments,
		findNamespaceStartPage,
		buildNamespaceTree,
		type NamespaceTreeNode
	} from '$lib/wiki/namespaces';
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
	let indexViewMode = $state<'tree' | 'flat'>('tree');
	let collapsedFolders = $state<Record<string, boolean>>({});
	let showNewPageModal = $state(false);
	let newPageTitle = $state('');
	let newPageNamespace = $state('');
	let showDeleteConfirm = $state(false);
	let copyFeedback = $state(false);

	let viewportHeight = $state('100vh');
	let viewportTop = $state('0px');

	let previousHash = '';

	function getWikiSlugFromHash(rawHash: string): string | null {
		const clean = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
		if (clean.startsWith('wiki:')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('wiki/')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('wiki=')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('w/')) return decodeURIComponent(clean.slice(2));
		if (clean.startsWith('w:')) return decodeURIComponent(clean.slice(2));
		return null;
	}

	function handleClose() {
		if (typeof window !== 'undefined') {
			const currentHash = window.location.hash;
			if (currentHash.startsWith('#wiki') || currentHash.startsWith('#w/')) {
				const cleanUrl = window.location.pathname + window.location.search + (previousHash || '');
				window.history.replaceState(null, '', cleanUrl || '#');
			}
		}
		onClose();
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			const initialHash = window.location.hash;
			if (!initialHash.startsWith('#wiki') && !initialHash.startsWith('#w/')) {
				previousHash = initialHash;
			}
			const targetHash = `#wiki:${encodeURI(currentPageId)}`;
			if (window.location.hash !== targetHash) {
				window.history.pushState(null, '', targetHash);
			}

			function onHashChange() {
				const slug = getWikiSlugFromHash(window.location.hash);
				if (slug) {
					const normalized = slugifyWikiPage(slug);
					if (normalized !== currentPageId) {
						currentPageId = normalized;
						if (!history.includes(normalized)) {
							history = [...history, normalized];
						}
						showIndex = false;
						showHistory = false;
						selectedRevision = null;
					}
				} else {
					onClose();
				}
			}

			window.addEventListener('popstate', onHashChange);
			window.addEventListener('hashchange', onHashChange);
			return () => {
				window.removeEventListener('popstate', onHashChange);
				window.removeEventListener('hashchange', onHashChange);
			};
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			const currentHash = window.location.hash;
			if (currentHash.startsWith('#wiki') || currentHash.startsWith('#w/')) {
				const cleanUrl = window.location.pathname + window.location.search + (previousHash || '');
				window.history.replaceState(null, '', cleanUrl || '#');
			}
		}
	});

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

	const namespaceSegments = $derived(getNamespaceSegments(currentPageId));
	const pageBaseName = $derived(getPageBaseName(currentPageId));
	const currentNamespace = $derived(getNamespace(currentPageId));

	interface LinkedEntityInfo {
		type: 'item' | 'list';
		id: string;
		name: string;
		listId?: string;
		listName?: string;
		isNote?: boolean;
	}

	const linkedEntity = $derived.by<LinkedEntityInfo | null>(() => {
		void docState.version;
		if (currentPageId.startsWith('item:')) {
			const itemId = currentPageId.slice(5).trim();
			try {
				const doc = getDoc();
				const itemsArr = getItems(doc);
				let foundItem: { id: string; name: string; listId: string; isNote: boolean } | null = null;
				for (let i = 0; i < itemsArr.length; i++) {
					const m = itemsArr.get(i);
					if (m.get('id') === itemId) {
						foundItem = {
							id: itemId,
							name: (m.get('name') as string) || 'Untitled',
							listId: (m.get('listId') as string) || '',
							isNote: Boolean(m.get('isNote') || m.get('note'))
						};
						break;
					}
				}
				if (foundItem) {
					let listName = '';
					const listsArr = getLists(doc);
					for (let i = 0; i < listsArr.length; i++) {
						const lm = listsArr.get(i);
						if (lm.get('id') === foundItem.listId) {
							listName = (lm.get('name') as string) || 'Untitled List';
							break;
						}
					}
					return {
						type: 'item',
						id: itemId,
						name: foundItem.name,
						listId: foundItem.listId,
						listName,
						isNote: foundItem.isNote
					};
				}
			} catch {}
			return { type: 'item', id: itemId, name: `Todo ${itemId.slice(0, 8)}…`, listId: '', listName: '', isNote: false };
		}
		if (currentPageId.startsWith('list:')) {
			const listId = currentPageId.slice(5).trim();
			try {
				const doc = getDoc();
				const listsArr = getLists(doc);
				let listName = '';
				listsArr.forEach((lm) => {
					if (lm.get('id') === listId) {
						listName = (lm.get('name') as string) || 'Untitled List';
					}
				});
				if (listName) {
					return {
						type: 'list',
						id: listId,
						name: listName,
						listId,
						listName,
						isNote: false
					};
				}
			} catch {}
			return { type: 'list', id: listId, name: `List ${listId.slice(0, 8)}…`, listId, listName: '', isNote: false };
		}
		return null;
	});

	const defaultPageTitle = $derived.by(() => {
		if (currentPage?.title) return currentPage.title;
		if (linkedEntity?.name) return linkedEntity.name;
		if (currentPageId === 'start') return 'Start Page';
		return pageBaseName || currentPageId;
	});

	const defaultPageContent = $derived.by(() => {
		if (currentPage?.content) return currentPage.content;
		if (linkedEntity) {
			if (linkedEntity.type === 'item') {
				return `====== ${linkedEntity.name} ======\n\nDedicated wiki documentation for [[item:${linkedEntity.id}|${linkedEntity.name}]].\n\n`;
			}
			if (linkedEntity.type === 'list') {
				return `====== ${linkedEntity.name} ======\n\nDedicated wiki documentation for list [[list:${linkedEntity.id}|${linkedEntity.name}]].\n\n`;
			}
		}
		return `====== ${defaultPageTitle} ======\n\nWrite your content here...`;
	});

	const filteredPages = $derived(
		allPages.filter(
			(p) =>
				!indexSearch ||
				p.title.toLowerCase().includes(indexSearch.toLowerCase()) ||
				p.id.includes(indexSearch.toLowerCase())
		)
	);

	const namespaceTree = $derived(buildNamespaceTree(filteredPages));

	// Rendered HTML of the current page
	const renderedHtml = $derived.by(() => {
		if (!currentPage) return '';
		return renderDokuWiki(currentPage.content, {
			currentSlug: currentPage.id,
			resolveWikiTitle: (slug) => {
				const page = allPages.find((p) => p.id === slug);
				if (page?.title) return page.title;
				if (slug.startsWith('item:')) {
					const id = slug.slice(5).trim();
					try {
						const doc = getDoc();
						const itemsArr = getItems(doc);
						let foundName = '';
						itemsArr.forEach((m) => {
							if (m.get('id') === id) foundName = (m.get('name') as string) || '';
						});
						if (foundName) return foundName;
					} catch {}
				}
				if (slug.startsWith('list:')) {
					const id = slug.slice(5).trim();
					try {
						const doc = getDoc();
						const listsArr = getLists(doc);
						let foundName = '';
						listsArr.forEach((m) => {
							if (m.get('id') === id) foundName = (m.get('name') as string) || '';
						});
						if (foundName) return foundName;
					} catch {}
				}
				return undefined;
			},
			pageExists: (slug) => allPages.some((p) => p.id === slug)
		});
	});

	const sortedRevisions = $derived((currentPage?.revisions ?? []).slice().reverse());

	function navigateToPage(id: string) {
		const slug = slugifyWikiPage(id);
		if (slug !== currentPageId) {
			currentPageId = slug;
			history = [...history, slug];
			if (typeof window !== 'undefined') {
				const targetHash = `#wiki:${encodeURI(slug)}`;
				if (window.location.hash !== targetHash) {
					window.history.pushState(null, '', targetHash);
				}
			}
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
			if (typeof window !== 'undefined') {
				const targetHash = `#wiki:${encodeURI(prevPage)}`;
				if (window.location.hash !== targetHash) {
					window.history.pushState(null, '', targetHash);
				}
			}
		} else {
			handleClose();
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
				handleClose();
				if (refType === 'item') {
					if (onNavigateToItem) {
						onNavigateToItem(refId);
					}
				} else if (refType === 'list') {
					if (onNavigateToList) {
						onNavigateToList(refId);
					}
				} else if (refType === 'folder') {
					if (onNavigateToFolder) {
						onNavigateToFolder(refId);
					}
				}
			}
		}
	}

	function jumpToLinkedEntity() {
		if (!linkedEntity) return;
		handleClose();
		if (linkedEntity.type === 'item') {
			if (onNavigateToItem) {
				onNavigateToItem(linkedEntity.id, linkedEntity.listId);
			}
		} else if (linkedEntity.type === 'list') {
			if (onNavigateToList) {
				onNavigateToList(linkedEntity.id);
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

	function navigateToNamespace(ns: string) {
		const startPage = findNamespaceStartPage(ns, allPages);
		if (startPage) {
			navigateToPage(startPage);
		} else {
			showIndex = true;
			showHistory = false;
			selectedRevision = null;
			indexSearch = `${ns}:`;
		}
	}

	function isFolderCollapsed(path: string): boolean {
		if (indexSearch.trim()) return false;
		return Boolean(collapsedFolders[path]);
	}

	function toggleFolder(path: string) {
		collapsedFolders = {
			...collapsedFolders,
			[path]: !collapsedFolders[path]
		};
	}

	function expandAllFolders() {
		collapsedFolders = {};
	}

	function collapseAllFolders() {
		const res: Record<string, boolean> = {};
		function collect(node: NamespaceTreeNode) {
			if (!node.isRoot) res[node.fullPath] = true;
			for (const sub of node.subNamespaces) collect(sub);
		}
		collect(namespaceTree);
		collapsedFolders = res;
	}

	function openNewPageModal(defaultNs?: string) {
		newPageNamespace = defaultNs !== undefined ? defaultNs : currentNamespace;
		newPageTitle = '';
		showNewPageModal = true;
	}

	function createNewPage() {
		if (!newPageTitle.trim()) return;
		const rawTitle = newPageTitle.trim();
		let targetSlug: string;
		if (rawTitle.includes(':') || rawTitle.startsWith(':')) {
			targetSlug = slugifyWikiPage(rawTitle);
		} else if (newPageNamespace.trim()) {
			targetSlug = slugifyWikiPage(`${newPageNamespace.trim()}:${rawTitle}`);
		} else {
			targetSlug = slugifyWikiPage(rawTitle);
		}

		currentPageId = targetSlug;
		history = [...history, targetSlug];
		newPageTitle = '';
		newPageNamespace = '';
		showNewPageModal = false;
		showIndex = false;
		isEditing = true;
	}

	function copyLink() {
		const url = typeof window !== 'undefined'
			? `${window.location.origin}${window.location.pathname}#wiki:${encodeURI(currentPageId)}`
			: `[[wiki:${currentPageId}]]`;
		navigator.clipboard.writeText(url).catch(() => {
			const ta = document.createElement('textarea');
			ta.value = url;
			ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
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
			<div class="wiki-toolbar">
				<button
					type="button"
					class="hdr-btn"
					onclick={handleBack}
					title={history.length > 1 ? 'Go Back' : 'Close Wiki'}
					aria-label={history.length > 1 ? 'Go Back' : 'Close Wiki'}
				>
					{history.length > 1 ? '←' : '✕'}
				</button>
				{#if linkedEntity}
					<button
						type="button"
						class="hdr-btn entity-hdr-jump-btn"
						onclick={jumpToLinkedEntity}
						title="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}: {linkedEntity.name}"
						aria-label="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}"
					>
						{linkedEntity.type === 'item' ? (linkedEntity.isNote ? '📝' : '☑️') : '📋'}
					</button>
				{/if}
				{#if !commitState.isHistorical}
					<button
						type="button"
						class="hdr-btn"
						onclick={() => {
							showIndex = false;
							showHistory = false;
							isEditing = true;
						}}
						title="Edit Page"
						aria-label="Edit Page"
					>
						✏️
					</button>
				{/if}
				<button
					type="button"
					class="hdr-btn index-toggle-btn"
					class:active={showIndex}
					onclick={() => {
						showIndex = !showIndex;
						if (showIndex) showHistory = false;
					}}
					title={showIndex ? 'Close Page Index' : 'All Wiki Pages'}
					aria-label="All Wiki Pages"
				>
					📑
				</button>
				{#if currentPage}
					<button
						type="button"
						class="hdr-btn history-toggle-btn"
						class:active={showHistory}
						onclick={() => {
							showHistory = !showHistory;
							selectedRevision = null;
							if (showHistory) showIndex = false;
						}}
						title={showHistory ? 'Close History' : `Revision History${currentPage.revisions?.length ? ` (${currentPage.revisions.length} revisions)` : ''}`}
						aria-label="Revision History"
					>
						📜
					</button>
				{/if}
				<button
					type="button"
					class="hdr-btn new-page-btn"
					onclick={() => openNewPageModal()}
					title="Create New Page"
					aria-label="Create New Page"
				>
					➕
				</button>
				<button
					type="button"
					class="hdr-btn"
					onclick={copyLink}
					title={copyFeedback ? 'Copied URL to clipboard!' : `Copy Web URL (#wiki:${currentPageId})`}
					aria-label="Copy Web URL"
				>
					{copyFeedback ? '✓' : '🔗'}
				</button>
				{#if !commitState.isHistorical && currentPage && currentPageId !== 'start'}
					<button
						type="button"
						class="hdr-btn delete-btn"
						onclick={() => (showDeleteConfirm = true)}
						title="Delete Page"
						aria-label="Delete Page"
					>
						🗑️
					</button>
				{/if}
			</div>

			<div class="hdr-title" title="Slug: {currentPageId}">
				<span class="wiki-icon">📖</span>
				<span class="title-text">{currentPage?.title || linkedEntity?.name || currentPageId}</span>
			</div>
		</header>

		<!-- Main Area -->
		<div class="wiki-body">
			{#if showIndex}
				<!-- All Pages Index View -->
				<div class="wiki-index-pane">
					<div class="index-toolbar">
						<input
							type="text"
							class="index-search-input"
							placeholder="Search pages or namespaces..."
							bind:value={indexSearch}
						/>
						<div class="index-view-toggles">
							<button
								type="button"
								class="mode-toggle-btn"
								class:active={indexViewMode === 'tree'}
								onclick={() => (indexViewMode = 'tree')}
								title="Hierarchical Namespace Tree"
							>
								🌳 Tree
							</button>
							<button
								type="button"
								class="mode-toggle-btn"
								class:active={indexViewMode === 'flat'}
								onclick={() => (indexViewMode = 'flat')}
								title="Flat List"
							>
								📋 Flat
							</button>
						</div>
					</div>

					{#if indexViewMode === 'tree' && allPages.length > 0}
						<div class="tree-controls">
							<button type="button" class="tree-ctrl-btn" onclick={expandAllFolders}>Expand All</button>
							<button type="button" class="tree-ctrl-btn" onclick={collapseAllFolders}>Collapse All</button>
							<span class="tree-stats">{filteredPages.length} {filteredPages.length === 1 ? 'page' : 'pages'}</span>
						</div>
					{/if}

					<div class="index-page-list">
						{#if allPages.length === 0}
							<div class="empty-pages-msg">
								<p>No wiki pages created yet.</p>
								<button type="button" class="primary-btn" onclick={() => { navigateToPage('start'); isEditing = true; showIndex = false; }}>
									Create Start Page
								</button>
							</div>
						{:else if indexViewMode === 'tree'}
							<div class="ns-tree-container">
								{@render renderNamespaceNode(namespaceTree, 0)}
							</div>
						{:else}
							{#each filteredPages as p}
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
							<div class="history-title-row">
								<h2>Revision History for "{currentPage?.title || currentPageId}"</h2>
								<button type="button" class="hdr-btn" onclick={() => { showHistory = false; selectedRevision = null; }} title="Close History" aria-label="Close History">✕</button>
							</div>
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
						<!-- Namespace Breadcrumbs (scrolls with content) -->
						<nav class="wiki-breadcrumbs" aria-label="Namespace breadcrumbs">
							<button type="button" class="bc-item bc-root" onclick={() => navigateToPage('start')} title="Start / Root">
								🏠 <span class="bc-name">root</span>
							</button>
							{#each namespaceSegments as seg}
								<span class="bc-sep">:</span>
								<button type="button" class="bc-item bc-ns" onclick={() => navigateToNamespace(seg.fullPath)} title="Namespace: {seg.fullPath}">
									📁 <span class="bc-name">{seg.name}</span>
								</button>
							{/each}
							<span class="bc-sep">:</span>
							<span class="bc-current" title="Page: {currentPage?.title || linkedEntity?.name || pageBaseName}">
								📄 <span class="bc-name">{currentPage?.title || linkedEntity?.name || pageBaseName}</span>
							</span>
						</nav>

						{#if currentPage}
							<!-- Page Title & Meta -->
							<div class="article-meta-header">
								<div class="article-title-row">
									<h1 class="page-main-heading">{currentPage.title}</h1>
									{#if linkedEntity}
										<button
											type="button"
											class="entity-jump-icon-btn"
											onclick={jumpToLinkedEntity}
											title="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}: {linkedEntity.name}"
											aria-label="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}"
										>
											{linkedEntity.type === 'item' ? (linkedEntity.isNote ? '📝' : '☑️') : '📋'}
										</button>
									{/if}
								</div>
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
								<div class="article-title-row">
									<h2>Topic does not exist yet</h2>
									{#if linkedEntity}
										<button
											type="button"
											class="entity-jump-icon-btn"
											onclick={jumpToLinkedEntity}
											title="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}: {linkedEntity.name}"
											aria-label="Jump to {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'Note' : 'Todo') : 'List'}"
										>
											{linkedEntity.type === 'item' ? (linkedEntity.isNote ? '📝' : '☑️') : '📋'}
										</button>
									{/if}
								</div>
								<p>
									{#if linkedEntity}
										There is currently no wiki page for this {linkedEntity.type === 'item' ? (linkedEntity.isNote ? 'note' : 'todo') : 'list'} (<code>{currentPageId}</code>).
									{:else}
										There is currently no wiki page for <code>{currentPageId}</code>.
									{/if}
								</p>
								{#if !commitState.isHistorical}
									<button
										type="button"
										class="primary-btn create-page-btn"
										onclick={() => (isEditing = true)}
									>
										✏️ Create "{linkedEntity?.name || currentPageId}" Page
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

{#snippet renderNamespaceNode(node: NamespaceTreeNode, depth: number)}
	{#if !node.isRoot}
		<div class="ns-folder-row" style="padding-left: {depth * 1.1}rem">
			<button
				type="button"
				class="ns-folder-toggle-btn"
				onclick={() => toggleFolder(node.fullPath)}
				title={isFolderCollapsed(node.fullPath) ? 'Expand namespace' : 'Collapse namespace'}
			>
				<span class="ns-arrow">{isFolderCollapsed(node.fullPath) ? '▶' : '▼'}</span>
				<span class="ns-icon">📁</span>
				<span class="ns-name">{node.name}</span>
				<span class="ns-count">({node.totalPageCount})</span>
			</button>
			{#if !commitState.isHistorical}
				<button
					type="button"
					class="ns-quick-add"
					title={`Create new page in namespace "${node.fullPath}"`}
					onclick={() => openNewPageModal(node.fullPath)}
				>
					➕
				</button>
			{/if}
		</div>
	{/if}

	{#if node.isRoot || !isFolderCollapsed(node.fullPath)}
		{#each node.subNamespaces as child}
			{@render renderNamespaceNode(child, node.isRoot ? 0 : depth + 1)}
		{/each}

		{#each node.pages as p}
			<div class="ns-page-row" style="padding-left: {(node.isRoot ? 0.3 : (depth + 1) * 1.15)}rem">
				<button
					type="button"
					class="ns-page-link"
					class:current={p.id === currentPageId}
					onclick={() => navigateToPage(p.id)}
					title="Open {p.title || p.id}"
				>
					<span class="page-icon">📄</span>
					<span class="page-title">{p.title || getPageBaseName(p.id)}</span>
					{#if p.title && p.title !== getPageBaseName(p.id)}
						<span class="page-basename">({getPageBaseName(p.id)})</span>
					{/if}
				</button>
			</div>
		{/each}
	{/if}
{/snippet}

	<!-- Full-screen DokuWiki Editor -->
	{#if isEditing}
		<WikiEditor
			pageId={currentPageId}
			initialTitle={defaultPageTitle}
			initialContent={defaultPageContent}
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

				<div class="dialog-field">
					<label for="new-page-ns">Namespace (optional):</label>
					<input
						id="new-page-ns"
						type="text"
						class="dialog-input"
						placeholder="e.g. projects:client_a (or leave empty for root)"
						bind:value={newPageNamespace}
					/>
				</div>

				<div class="dialog-field">
					<label for="new-page-title">Page Title or Name:</label>
					<input
						id="new-page-title"
						type="text"
						class="dialog-input"
						placeholder="e.g. Architecture Overview, Meeting Notes"
						bind:value={newPageTitle}
						onkeydown={(e) => { if (e.key === 'Enter') createNewPage(); }}
					/>
				</div>

				{#if newPageTitle.trim()}
					<div class="dialog-slug-preview">
						Target ID: <code>{
							newPageTitle.includes(':')
								? slugifyWikiPage(newPageTitle)
								: newPageNamespace.trim()
									? slugifyWikiPage(`${newPageNamespace.trim()}:${newPageTitle}`)
									: slugifyWikiPage(newPageTitle)
						}</code>
					</div>
				{/if}

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
		padding: 0.5rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		min-height: 52px;
		gap: 0.75rem;
	}
	.wiki-toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		overflow-x: auto;
		white-space: nowrap;
		flex-shrink: 0;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.wiki-toolbar::-webkit-scrollbar {
		display: none;
	}
	.wiki-toolbar .hdr-btn {
		flex-shrink: 0;
	}
	.hdr-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		font-size: 1.05rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}
	.wiki-icon {
		font-size: 1.15rem;
		flex-shrink: 0;
	}
	.title-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		.wiki-header {
			padding: 0.35rem 0.5rem;
			gap: 0.35rem;
			min-height: auto;
		}
		.wiki-toolbar {
			width: 100%;
			padding-bottom: 0;
		}
		.hdr-title {
			display: none;
		}
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
	.index-toggle-btn.active,
	.history-toggle-btn.active {
		background: var(--bg3);
		border-color: var(--accent);
		color: var(--accent);
	}
	.new-page-btn {
		background: #6366f1;
		color: #fff;
		border-color: #6366f1;
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

	/* Breadcrumbs */
	.wiki-breadcrumbs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding: 0 0 0.75rem;
		font-size: 0.85rem;
		color: var(--text2);
	}
	.bc-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		font-weight: 500;
	}
	.bc-item:hover {
		background: var(--bg3);
		text-decoration: underline;
	}
	.bc-sep {
		color: var(--text2);
		font-weight: bold;
		user-select: none;
	}
	.bc-current {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text);
		font-weight: 600;
		padding: 0.15rem 0.35rem;
	}

	/* Index Pane */
	.wiki-index-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		width: 100%;
		overflow: hidden;
	}
	.index-toolbar {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
	}
	.index-search-input {
		flex: 1;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		font-size: 0.95rem;
	}
	.index-view-toggles {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}
	.mode-toggle-btn {
		background: var(--bg2);
		border: none;
		color: var(--text2);
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.mode-toggle-btn.active {
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}
	.tree-controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
		font-size: 0.82rem;
	}
	.tree-ctrl-btn {
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 0.2rem 0.5rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.tree-ctrl-btn:hover {
		border-color: var(--accent);
	}
	.tree-stats {
		margin-left: auto;
		color: var(--text2);
	}
	.ns-tree-container {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.25rem 0.25rem;
	}
	.ns-folder-row {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.35rem;
		padding: 0.2rem 0;
	}
	.ns-folder-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		color: var(--text);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		border-radius: 4px;
	}
	.ns-folder-toggle-btn:hover {
		color: var(--accent);
	}
	.ns-arrow {
		font-size: 0.7rem;
		color: var(--text2);
		width: 1ch;
	}
	.ns-count {
		font-size: 0.8rem;
		color: var(--text2);
		font-weight: normal;
	}
	.ns-quick-add {
		background: none;
		border: none;
		font-size: 0.8rem;
		cursor: pointer;
		opacity: 0.5;
		padding: 0.15rem 0.3rem;
		border-radius: 4px;
	}
	.ns-quick-add:hover {
		opacity: 1;
		color: var(--accent);
	}
	.ns-page-row {
		display: flex;
		align-items: center;
		padding: 0.15rem 0;
	}
	.ns-page-link {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		background: none;
		border: none;
		color: var(--text);
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.15rem 0.3rem;
		text-align: left;
		border-radius: 4px;
		line-height: 1.4;
	}
	.ns-page-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.ns-page-link.current {
		color: var(--accent);
		font-weight: 600;
	}
	.ns-page-link .page-icon {
		font-size: 0.9rem;
		opacity: 0.85;
	}
	.ns-page-link .page-title {
		font-size: 0.95rem;
	}
	.page-basename {
		font-size: 0.8rem;
		color: var(--text2);
		font-family: monospace;
	}
	.index-page-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.index-page-item {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border: none;
		border-bottom: 1px solid var(--border);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.index-page-item:hover {
		color: var(--accent);
		background: var(--bg2);
	}
	.index-page-item.current {
		color: var(--accent);
		font-weight: 600;
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
		width: 100%;
		padding-bottom: 4rem;
	}
	/* Linked Entity Jump Icons */
	.article-title-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.article-title-row .page-main-heading,
	.article-title-row h2 {
		margin: 0;
	}
	.entity-jump-icon-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
	}
	.entity-jump-icon-btn:hover {
		background: var(--bg3);
		border-color: var(--accent);
		transform: scale(1.08);
	}
	.entity-jump-icon-btn:active {
		transform: scale(0.96);
	}
	.entity-hdr-jump-btn {
		border-color: var(--accent);
		padding: 0.25rem 0.5rem;
		font-size: 1.05rem;
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
	}
	.dialog-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.9rem;
	}
	.dialog-field label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text2);
	}
	.dialog-slug-preview {
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		font-size: 0.85rem;
		color: var(--text2);
		margin-bottom: 1rem;
	}
	.dialog-slug-preview code {
		color: var(--accent);
		font-weight: 600;
	}
	:global(.wiki-link-missing) {
		color: #ef4444 !important;
		text-decoration-style: dashed !important;
		text-decoration-line: underline !important;
	}
	:global(.wiki-link-missing:hover) {
		opacity: 0.8;
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
		width: 100%;
		overflow: hidden;
	}
	.history-list-header {
		margin-bottom: 1rem;
	}
	.history-title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
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

