/**
 * DokuWiki-style namespace utilities for the Mini Wiki.
 * Supports:
 * - Namespace parsing and slugification (: separated)
 * - Relative and absolute link resolution (. / .. / : prefix)
 * - Namespace segments and breadcrumb extraction
 * - Hierarchical sitemap / namespace tree generation
 */
import type { WikiPage } from './data';

export interface NamespaceSegment {
	name: string;
	fullPath: string;
}

export interface NamespaceTreeNode {
	name: string;
	fullPath: string;
	isRoot: boolean;
	subNamespaces: NamespaceTreeNode[];
	pages: WikiPage[];
	totalPageCount: number;
}

/**
 * Clean a wiki page slug or namespace path, standardizing colons as namespace separators.
 */
export function cleanNamespaceSlug(input: string): string {
	const trimmed = input.trim().toLowerCase();
	let slug = trimmed
		.replace(/\s*:\s*/g, ':')
		.replace(/[\s/\\?#%&]+/g, '_')
		.replace(/[^a-z0-9_\-:]/g, '')
		.replace(/:+/g, ':')
		.replace(/_+/g, '_')
		.replace(/^[:_]+|[:_]+$/g, '');
	return slug || 'start';
}

/**
 * Get the namespace portion of a page slug (everything before the last colon),
 * or '' if the page is at root.
 * e.g. "projects:client_a:specs" -> "projects:client_a"
 * e.g. "start" -> ""
 */
export function getNamespace(slug: string): string {
	const clean = cleanNamespaceSlug(slug);
	const lastColon = clean.lastIndexOf(':');
	if (lastColon === -1) return '';
	return clean.slice(0, lastColon);
}

/**
 * Get the base page name without its namespace prefix.
 * e.g. "projects:client_a:specs" -> "specs"
 * e.g. "start" -> "start"
 */
export function getPageBaseName(slug: string): string {
	const clean = cleanNamespaceSlug(slug);
	const lastColon = clean.lastIndexOf(':');
	if (lastColon === -1) return clean;
	return clean.slice(lastColon + 1);
}

/**
 * Get breadcrumb segments for the namespace hierarchy of a page slug.
 * e.g. "projects:client_a:specs" ->
 *   [{ name: "projects", fullPath: "projects" }, { name: "client_a", fullPath: "projects:client_a" }]
 */
export function getNamespaceSegments(slug: string): NamespaceSegment[] {
	const ns = getNamespace(slug);
	if (!ns) return [];
	const parts = ns.split(':');
	const segments: NamespaceSegment[] = [];
	let current = '';
	for (const part of parts) {
		current = current ? `${current}:${part}` : part;
		segments.push({ name: part, fullPath: current });
	}
	return segments;
}

/**
 * Resolves a DokuWiki link target relative to the current page slug.
 * - Leading colon ":foo:bar" -> absolute path "foo:bar"
 * - Relative ".:subpage" or ".:" -> in current page namespace
 * - Relative "..:sibling" or "..:" -> in parent namespace
 * - Relative "..:..:other" -> in ancestor namespace
 * - Bare "target" or "subns:target":
 *     Checks current namespace first: if `${currentNs}:${target}` exists -> use it
 *     Else if root `${target}` exists -> use it
 *     Else defaults to `${currentNs}:${target}` if in a namespace, otherwise `target`
 */
export function resolveNamespaceLink(
	target: string,
	currentSlug = 'start',
	pageExists?: (slug: string) => boolean
): string {
	let raw = target.trim();
	if (raw.startsWith('wiki:')) {
		raw = raw.slice(5).trim();
	}

	// 1. Explicitly absolute from root: [[:foo:bar]]
	if (raw.startsWith(':')) {
		return cleanNamespaceSlug(raw);
	}

	const currentNs = getNamespace(currentSlug);
	const nsStack = currentNs ? currentNs.split(':') : [];

	// 2. Relative link with . or ..
	if (raw.startsWith('.') || raw.startsWith('..')) {
		const segments = raw.split(':');
		const stack = [...nsStack];

		while (segments.length > 0 && (segments[0] === '.' || segments[0] === '..')) {
			const op = segments.shift()!;
			if (op === '..') {
				stack.pop();
			}
			// '.' keeps current level in stack
		}

		if (segments.length === 0 || (segments.length === 1 && segments[0] === '')) {
			// e.g. ".:" or "..:" -> default to 'start' page in that namespace
			stack.push('start');
		} else {
			for (const seg of segments) {
				const cleaned = cleanNamespaceSlug(seg);
				if (cleaned) stack.push(cleaned);
			}
		}

		return cleanNamespaceSlug(stack.join(':'));
	}

	// 3. Normal / un-prefixed target
	const cleanedTarget = cleanNamespaceSlug(raw);

	if (!currentNs) {
		return cleanedTarget;
	}

	const inNsCandidate = cleanNamespaceSlug(`${currentNs}:${cleanedTarget}`);

	if (pageExists) {
		if (pageExists(inNsCandidate)) {
			return inNsCandidate;
		}
		if (pageExists(cleanedTarget)) {
			return cleanedTarget;
		}
	}

	// Default in DokuWiki: links inside a namespace target that namespace
	return inNsCandidate;
}

/**
 * Look for a default start page for a namespace.
 * Checks:
 * 1. ${namespace}:start
 * 2. ${namespace}:${lastNamespaceSegment}
 * 3. ${namespace}
 * 4. ${namespace}:index
 */
export function findNamespaceStartPage(namespace: string, allPages: WikiPage[]): string | null {
	if (!namespace) {
		const rootStart = allPages.find((p) => p.id === 'start');
		return rootStart ? 'start' : null;
	}
	const lastPart = namespace.split(':').pop() || '';
	const candidates = [
		`${namespace}:start`,
		`${namespace}:${lastPart}`,
		namespace,
		`${namespace}:index`
	];
	for (const cand of candidates) {
		const match = allPages.find((p) => p.id === cand);
		if (match) return match.id;
	}
	return null;
}

/**
 * Builds a hierarchical namespace tree from a list of wiki pages.
 */
export function buildNamespaceTree(pages: WikiPage[]): NamespaceTreeNode {
	interface InternalNode {
		name: string;
		fullPath: string;
		isRoot: boolean;
		subNamespaces: Map<string, InternalNode>;
		pages: WikiPage[];
	}

	const root: InternalNode = {
		name: 'root',
		fullPath: '',
		isRoot: true,
		subNamespaces: new Map(),
		pages: []
	};

	for (const page of pages) {
		const ns = getNamespace(page.id);
		if (!ns) {
			root.pages.push(page);
		} else {
			const parts = ns.split(':');
			let curr = root;
			let currPath = '';
			for (const part of parts) {
				currPath = currPath ? `${currPath}:${part}` : part;
				let next = curr.subNamespaces.get(part);
				if (!next) {
					next = {
						name: part,
						fullPath: currPath,
						isRoot: false,
						subNamespaces: new Map(),
						pages: []
					};
					curr.subNamespaces.set(part, next);
				}
				curr = next;
			}
			curr.pages.push(page);
		}
	}

	function finalize(node: InternalNode): NamespaceTreeNode {
		const subNodes: NamespaceTreeNode[] = [];
		const sortedKeys = Array.from(node.subNamespaces.keys()).sort((a, b) => a.localeCompare(b));
		let total = node.pages.length;

		for (const key of sortedKeys) {
			const child = finalize(node.subNamespaces.get(key)!);
			subNodes.push(child);
			total += child.totalPageCount;
		}

		// Sort pages in this node by title / base name
		const sortedPages = [...node.pages].sort((a, b) => {
			const nameA = a.title || getPageBaseName(a.id);
			const nameB = b.title || getPageBaseName(b.id);
			return nameA.localeCompare(nameB);
		});

		return {
			name: node.name,
			fullPath: node.fullPath,
			isRoot: node.isRoot,
			subNamespaces: subNodes,
			pages: sortedPages,
			totalPageCount: total
		};
	}

	return finalize(root);
}
