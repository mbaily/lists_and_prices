import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { findBillSections, billLine } from '../src/lib/billsInclude';

test('selects only known, distinct bill sections alongside ordinary references', () => {
	deepStrictEqual(findBillSections('[[bills:upcoming]] [[item:123]] [[bills:DUE_TODAY]] [[bills:upcoming]] [[bills:unknown]]'), ['upcoming', 'due_today']);
});

test('formats bill, payment and budget API fields', () => {
	strictEqual(billLine({ name: 'Power', effective_amount: 25, currency_symbol: '$', next_due_date: '2026-11-01', is_estimated: true }, 'upcoming'), 'Power · ≈$25.00 · Due 2026-11-01');
	strictEqual(billLine({ bill_name: 'Power', amount_paid: 0, currency_symbol: '$', paid_date: '2026-10-01' }, 'recent_payments'), 'Power · $0.00 · Paid 2026-10-01');
	strictEqual(billLine({ currency: 'AUD', amount: 100, currency_symbol: '$' }, 'monthly_estimates'), 'AUD · $100.00');
});
