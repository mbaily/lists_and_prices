/** Shared by clipboard imports and the task API. Matching is case-sensitive. */
export function importNameKey(name: string): string {
	const trimmed = name.trim();
	// Preserve inline tags, URL fragments, and names consisting only of tags.
	return trimmed.replace(/(?:\s+#\w+)+$/, '').trimEnd() || trimmed;
}
