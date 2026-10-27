/** Keep the mounted screen when refreshing data; forced reloads still load app code. */
export function installDataRefresh(
	target: Window,
	canRefresh: () => boolean,
	refresh: () => Promise<void>
): () => void {
	const keydown = (event: KeyboardEvent) => {
		const reloadKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
		if (!reloadKey || event.altKey || event.defaultPrevented) return;
		if (event.shiftKey || (event.key === 'F5' && (event.ctrlKey || event.metaKey))) {
			// Let Ctrl+Shift+R, Cmd+Shift+R and Ctrl+F5 perform a full reload.
			return;
		}
		if (!canRefresh()) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!event.repeat) void refresh();
	};

	// Browser toolbar reloads deliberately bypass page interception. Handle only
	// shortcuts delivered to the page, leaving app updates and full reloads alone.
	target.addEventListener('keydown', keydown, { capture: true });
	return () => {
		target.removeEventListener('keydown', keydown, { capture: true });
	};
}
