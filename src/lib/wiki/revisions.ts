/**
 * Revision history and thinning logic for wiki pages.
 */

export interface WikiRevision {
	timestamp: string; // ISO date string
	title: string;
	content: string;
	summary: string;
	isMinor: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/**
 * Thin revisions over time using an exponential/staged retention policy:
 * - < 24 hours: Keep all non-minor revisions; keep at most 1 minor revision per hour.
 * - 1 day to 7 days: Keep at most 1 revision per 4 hours.
 * - 7 days to 30 days: Keep at most 1 revision per day.
 * - 30 days to 180 days: Keep at most 1 revision per week.
 * - > 180 days: Keep at most 1 revision per month.
 * - Always retains the first (oldest) revision and most recent revision.
 * - Hard cap at maxRevisions (default 60).
 */
export function thinRevisions(
	revisions: WikiRevision[],
	now: Date = new Date(),
	maxRevisions = 60
): WikiRevision[] {
	if (revisions.length <= 2) return [...revisions];

	// Sort chronologically ascending (oldest first)
	const sorted = [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	const first = sorted[0];
	const last = sorted[sorted.length - 1];

	const nowTime = now.getTime();
	const kept: WikiRevision[] = [];

	let prevKeptTime = 0;

	for (let i = 0; i < sorted.length; i++) {
		const rev = sorted[i];

		// Always keep first and last
		if (i === 0 || i === sorted.length - 1) {
			kept.push(rev);
			prevKeptTime = new Date(rev.timestamp).getTime();
			continue;
		}

		const revTime = new Date(rev.timestamp).getTime();
		const age = Math.max(0, nowTime - revTime);
		const intervalSinceLast = revTime - prevKeptTime;

		let minInterval = 0;

		if (age < DAY_MS) {
			// Under 24h: keep all non-minor, or minor if at least 1 hour apart
			if (rev.isMinor) {
				minInterval = HOUR_MS;
			} else {
				minInterval = 0;
			}
		} else if (age < WEEK_MS) {
			// 1 to 7 days: 4 hours
			minInterval = 4 * HOUR_MS;
		} else if (age < MONTH_MS) {
			// 7 to 30 days: 1 day
			minInterval = DAY_MS;
		} else if (age < 6 * MONTH_MS) {
			// 30 to 180 days: 1 week
			minInterval = WEEK_MS;
		} else {
			// > 180 days: 1 month
			minInterval = MONTH_MS;
		}

		if (intervalSinceLast >= minInterval) {
			kept.push(rev);
			prevKeptTime = revTime;
		}
	}

	// If still exceeds maxRevisions, thin evenly keeping first and last
	if (kept.length > maxRevisions) {
		const excess = kept.length - maxRevisions;
		// Keep first and last, sample the middle
		const middle = kept.slice(1, -1);
		const step = middle.length / (middle.length - excess);
		const sampleMiddle: WikiRevision[] = [];
		for (let i = 0; i < middle.length - excess; i++) {
			const idx = Math.min(middle.length - 1, Math.floor(i * step));
			sampleMiddle.push(middle[idx]);
		}
		return [first, ...sampleMiddle, last];
	}

	return kept;
}

