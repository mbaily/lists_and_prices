export const billSections = {
	overdue: 'Overdue', due_today: 'Due today', upcoming: 'Upcoming',
	covered_early: 'Covered early', future_estimates: 'Future estimates',
	unscheduled: 'Unscheduled', recent_payments: 'Recent payments',
	monthly_estimates: 'Monthly estimates', inactive_bills: 'Inactive bills'
} as const;
export type BillSection = keyof typeof billSections;

export function findBillSections(text: string): BillSection[] {
	const found: BillSection[] = [];
	for (const match of text.matchAll(/\[\[bills:([a-z_]+)\]\]/gi)) {
		const section = match[1].toLowerCase() as BillSection;
		if (Object.hasOwn(billSections, section) && !found.includes(section)) found.push(section);
	}
	return found;
}

export function billLine(row: Record<string, unknown>, section: BillSection): string {
	const name = String(row.name ?? row.bill_name ?? row.currency ?? 'Bill');
	const amount = section === 'recent_payments' ? row.amount_paid : section === 'monthly_estimates' ? row.amount : row.effective_amount;
	const date = section === 'recent_payments' ? row.paid_date : row.next_due_date;
	const parts = [name];
	if (typeof amount === 'number' && Number.isFinite(amount)) parts.push(`${row.is_estimated ? '≈' : ''}${String(row.currency_symbol ?? row.currency ?? '')}${amount.toFixed(2)}`);
	if (typeof date === 'string' && date) parts.push(`${section === 'recent_payments' ? 'Paid' : 'Due'} ${date}`);
	return parts.join(' · ');
}
