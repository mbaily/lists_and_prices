<script lang="ts">
	import { base } from '$app/paths';
	import {
		calendarSections, calendarRange, calendarOccurrenceLabel, calendarLine, parseCalendarResponse,
		calendarQueryRange, isImportantOccurrence,
		type CalendarOccurrence, type CalendarSection
	} from '$lib/calendarInclude';
	import { simpleTodoPageUrl, simpleTodoApiUrl } from '$lib/simpleTodo';
	import type { CalendarInlineEntry, IncludeView } from '$lib/includeView';

	let { sections, displaySections = sections }: { sections: CalendarSection[]; displaySections?: CalendarSection[] } = $props();
	let occurrences = $state<CalendarOccurrence[]>([]);
	let now = $state(new Date());
	let error = $state('');
	let loading = $state(true);
	let controller: AbortController;
	const calendarUrl = simpleTodoPageUrl('calendar', base);

	function sectionRows(section: CalendarSection): CalendarOccurrence[] {
		const range = calendarRange(section, now);
		const todayStart = calendarRange('today', now).start;
		return occurrences.filter((row) => {
			const date = row.occurrence_at.slice(0, 10);
			if (date >= range.start && date <= range.end) return true;
			if (date < range.start && !row.completed) {
				if (row.is_important !== undefined) return Boolean(row.is_important);
				return Boolean(row.event.important_if_late && date < todayStart);
			}
			return false;
		});
	}

	export function sectionView(section: CalendarSection): IncludeView<CalendarInlineEntry> {
		if (loading) return { status: 'loading' };
		if (error) return { status: 'error', message: error };
		const todayStart = calendarRange('today', now).start;
		return {
			status: 'ready',
			entries: sectionRows(section).map((row) => {
				const isImportant = !row.completed && (
					row.is_important !== undefined
						? Boolean(row.is_important)
						: Boolean(row.event.important_if_late && row.occurrence_at.slice(0, 10) < todayStart)
				);
				return {
					label: calendarOccurrenceLabel(row, now),
					title: row.event.title,
					completed: row.completed,
					...(isImportant ? { isImportant: true } : {})
				};
			})
		};
	}

	async function refreshSelected(selected: CalendarSection[]) {
		controller?.abort();
		if (selected.length === 0) return;
		controller = new AbortController();
		const request = controller;
		const today = new Date();
		now = today;
		loading = true;
		error = '';
		const { start, end } = calendarQueryRange(selected, today);
		try {
			const url = simpleTodoApiUrl('api/calendar/events', base);
			url.searchParams.set('start_date', start);
			url.searchParams.set('end_date', end);
			const credentials = typeof location !== 'undefined' && url.origin !== location.origin ? 'include' : 'same-origin';
			const response = await fetch(url, { credentials, cache: 'no-store', signal: request.signal });
			if (response.status === 401 || response.status === 403) throw new Error('Sign in to Simple Todo to view calendar events.');
			if (!response.ok) throw new Error('Calendar service is unavailable.');
			const data: unknown = await response.json();
			if (request.signal.aborted) return;
			occurrences = parseCalendarResponse(data);
		} catch (e) {
			if (request.signal.aborted) return;
			occurrences = [];
			error = e instanceof Error ? e.message : 'Calendar service is unavailable.';
		} finally {
			if (!request.signal.aborted) loading = false;
		}
	}

	export function refresh() {
		return refreshSelected(sections);
	}

	$effect(() => {
		const selected = [...sections];
		void refreshSelected(selected);
		let timer: ReturnType<typeof setTimeout>;
		function scheduleMidnight() {
			const current = new Date();
			const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
			timer = setTimeout(() => { void refreshSelected(selected); scheduleMidnight(); }, midnight.getTime() - current.getTime() + 100);
		}
		scheduleMidnight();
		return () => { controller?.abort(); clearTimeout(timer); };
	});
</script>

{#if displaySections.length}
<div class="calendar-includes">
	{#if loading}<p>Loading calendar events…</p>
	{:else if error}<p>{error} <button onclick={refresh}>Retry</button></p>
	{:else}
		{#each displaySections as section}
			{@const rows = sectionRows(section)}
			<section aria-label={calendarSections[section]}>
				{#if rows.length === 0}<p>No events.</p>
				{:else}
					<ul>
						{#each rows as row}
							{@const important = isImportantOccurrence(row, now)}
							<li class:completed={row.completed} class:important={important}>
								<a href={calendarUrl} target="_blank" rel="noopener noreferrer">{calendarLine(calendarOccurrenceLabel(row, now), row.event.title)}</a>{#if important}{' '}<span class="calendar-important-badge" title="Important (late and unchecked)">⚠️ Important</span>{/if}{#if row.completed}{' (Completed)'}{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</div>
{/if}

<style>
	.calendar-includes { padding: 0 .75rem 0 0; color: var(--text2); font-size: .9rem; }
	p, ul { margin: 0; }
	ul { padding-left: 0; }
	a { color: inherit; }
	.completed a { text-decoration: line-through; }
	button { color: inherit; cursor: pointer; }
	.important {
		background-color: rgba(220, 38, 38, 0.1);
		border-left: 3px solid #dc2626;
		padding-left: 4px;
		border-radius: 2px;
	}
	.calendar-important-badge {
		display: inline-block;
		background-color: #fee2e2;
		color: #991b1b;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 10px;
		border: 1px solid #fca5a5;
		margin-left: 4px;
		vertical-align: middle;
	}
	@media (prefers-color-scheme: dark) {
		.important {
			background-color: rgba(220, 38, 38, 0.2);
			border-left: 3px solid #f87171;
		}
		.calendar-important-badge {
			background-color: #450a0a;
			color: #fca5a5;
			border-color: #991b1b;
		}
	}
</style>
