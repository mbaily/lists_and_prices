<script lang="ts">
	let { href, completed = false }: {
		href: string;
		completed?: boolean;
	} = $props();
</script>

<a
	class="include-checkbox-link"
	{href}
	target="_blank"
	rel="noopener noreferrer"
	aria-label={completed ? 'Completed' : 'Not completed'}
	onpointerdown={event => event.stopPropagation()}
	onclick={event => event.stopPropagation()}
><input
	type="checkbox"
	class="include-checkbox"
	checked={completed}
	disabled
	tabindex="-1"
	aria-hidden="true"
/></a>

<style>
	.include-checkbox-link {
		display: inline-flex;
		align-items: center;
		margin: 0 0.35rem 0 0;
		vertical-align: middle;
		cursor: pointer;
	}
	.include-checkbox {
		margin: 0;
		pointer-events: none;
	}
</style>
