<script lang="ts">
	import { base } from '$app/paths';
	import {
		calendarSections, calendarRange, calendarOccurrenceLabel, parseCalendarResponse,
		type CalendarOccurrence, type CalendarSection
	} from '$lib/calendarInclude';
	import type { CalendarInlineEntry, IncludeView } from '$lib/includeView';

	let { sections, displaySections = sections }: { sections: CalendarSection[]; displaySections?: CalendarSection[] } = $props();
	let occurrences = $state<CalendarOccurrence[]>([]);
	let now = $state(new Date());
	let error = $state('');
	let loading = $state(true);
	let controller: AbortController;
	const calendarUrl = `${base || ''}/../simple_todo/calendar`;

	function sectionRows(section: CalendarSection): CalendarOccurrence[] {
		const range = calendarRange(section, now);
		return occurrences.filter((row) => row.occurrence_at.slice(0, 10) >= range.start && row.occurrence_at.slice(0, 10) <= range.end);
	}

	export function sectionView(section: CalendarSection): IncludeView<CalendarInlineEntry> {
		if (loading) return { status: 'loading' };
		if (error) return { status: 'error', message: error };
		return {
			status: 'ready',
			entries: sectionRows(section).map((row) => ({
				label: calendarOccurrenceLabel(row, now), title: row.event.title, completed: row.completed
			}))
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
		const ranges = selected.map((section) => calendarRange(section, today));
		const start = ranges.map((range) => range.start).sort()[0];
		const end = ranges.map((range) => range.end).sort().reverse()[0];
		try {
			const url = new URL('../simple_todo/api/calendar/events', `${location.origin}${base || ''}/`);
			url.searchParams.set('start_date', start);
			url.searchParams.set('end_date', end);
			const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
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
							<li class:completed={row.completed}>
								<a href={calendarUrl} target="_blank" rel="noopener noreferrer">{calendarOccurrenceLabel(row, now)} · {row.event.title}</a>{#if row.completed}{' (Completed)'}{/if}
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
</style>
