export type IncludeView<T> =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'unavailable' }
	| { status: 'ready'; entries: T[] };

export type CalendarInlineEntry = {
	label: string;
	title: string;
	completed: boolean;
};
