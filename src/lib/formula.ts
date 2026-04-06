/**
 * Lightweight spreadsheet formula evaluator.
 * Supports:
 *   - Literals: numbers, quoted strings
 *   - Arithmetic: + - * / and parentheses
 *   - Cell refs: A1, B23 (up to ZZ cols)
 *   - Ranges: A1:C3
 *   - Functions: SUM, AVERAGE, AVG, MIN, MAX, COUNT, IF, ROUND, ABS, CONCAT
 */

// ── Cell reference helpers ────────────────────────────────────────────────────

/** "A" → 0, "B" → 1, "Z" → 25, "AA" → 26, etc. */
export function colLetterToIndex(letters: string): number {
	const s = letters.toUpperCase();
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		n = n * 26 + (s.charCodeAt(i) - 64);
	}
	return n - 1;
}

/** 0 → "A", 25 → "Z", 26 → "AA", etc. */
export function colIndexToLetter(n: number): string {
	let s = '';
	n++;
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

/** Parse "A1" → {row:0, col:0} */
function parseCellRef(ref: string): { row: number; col: number } | null {
	const m = ref.match(/^([A-Za-z]+)(\d+)$/);
	if (!m) return null;
	return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export type CellGetter = (row: number, col: number) => string;

type EvalError = { error: string };
type EvalResult = number | string | EvalError;

function isError(v: EvalResult): v is EvalError {
	return typeof v === 'object' && v !== null;
}

/** Expand a range A1:C3 into array of cell values. */
function expandRange(range: string, getter: CellGetter): EvalResult[] {
	const m = range.match(/^([A-Za-z]+\d+):([A-Za-z]+\d+)$/i);
	if (!m) return [{ error: `#BAD_RANGE: ${range}` }];
	const from = parseCellRef(m[1]);
	const to = parseCellRef(m[2]);
	if (!from || !to) return [{ error: `#BAD_RANGE` }];
	const results: EvalResult[] = [];
	for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
		for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
			const raw = getter(r, c);
			results.push(coerce(raw, getter));
		}
	}
	return results;
}

function coerce(raw: string, getter: CellGetter): EvalResult {
	if (raw === '' || raw === undefined) return 0;
	if (raw.startsWith('=')) return evaluateFormula(raw, getter);
	const n = Number(raw);
	return isNaN(n) ? raw : n;
}

function toNum(v: EvalResult, name: string): number | EvalError {
	if (isError(v)) return v;
	if (typeof v === 'number') return v;
	const n = Number(v);
	if (isNaN(n)) return { error: `#VALUE: ${name} expects number, got "${v}"` };
	return n;
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────

type Token =
	| { type: 'NUM'; val: number }
	| { type: 'STR'; val: string }
	| { type: 'RANGE'; val: string }
	| { type: 'REF'; val: string }
	| { type: 'NAME'; val: string }
	| { type: 'OP'; val: string }
	| { type: 'LPAREN' }
	| { type: 'RPAREN' }
	| { type: 'COMMA' }
	| { type: 'SEMI' };

function tokenise(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < expr.length) {
		const ch = expr[i];
		if (/\s/.test(ch)) { i++; continue; }
		if (ch === '"' || ch === "'") {
			const q = ch;
			let s = '';
			i++;
			while (i < expr.length && expr[i] !== q) {
				s += expr[i++];
			}
			i++; // closing quote
			tokens.push({ type: 'STR', val: s });
			continue;
		}
		if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
			let s = '';
			while (i < expr.length && /[\d.]/.test(expr[i])) s += expr[i++];
			tokens.push({ type: 'NUM', val: parseFloat(s) });
			continue;
		}
		if (/[A-Za-z]/.test(ch)) {
			let s = '';
			while (i < expr.length && /[A-Za-z]/.test(expr[i])) s += expr[i++];
			// Check for range (letters+digits : letters+digits)
			if (/\d/.test(expr[i] ?? '')) {
				let s2 = s;
				while (i < expr.length && /\d/.test(expr[i])) s2 += expr[i++];
				if (expr[i] === ':') {
					s2 += expr[i++]; // ':'
					while (i < expr.length && /[A-Za-z]/.test(expr[i])) s2 += expr[i++];
					while (i < expr.length && /\d/.test(expr[i])) s2 += expr[i++];
					tokens.push({ type: 'RANGE', val: s2 });
				} else {
					tokens.push({ type: 'REF', val: s2 });
				}
			} else {
				tokens.push({ type: 'NAME', val: s.toUpperCase() });
			}
			continue;
		}
		if ('+-*/^'.includes(ch)) { tokens.push({ type: 'OP', val: ch }); i++; continue; }
		if (ch === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
		if (ch === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
		if (ch === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }
		if (ch === ';') { tokens.push({ type: 'SEMI' }); i++; continue; }
		if (ch === '%') { tokens.push({ type: 'OP', val: '%' }); i++; continue; }
		i++; // skip unknown
	}
	return tokens;
}

// ── Recursive descent parser / evaluator ─────────────────────────────────────

class Parser {
	private pos = 0;
	constructor(private tokens: Token[], private getter: CellGetter) {}

	private peek(): Token | undefined { return this.tokens[this.pos]; }
	private eat(): Token { return this.tokens[this.pos++]; }

	parse(): EvalResult {
		const v = this.expr();
		return v;
	}

	private expr(): EvalResult {
		return this.addSub();
	}

	private addSub(): EvalResult {
		let left = this.mulDiv();
		while (true) {
			const t = this.peek();
			if (t?.type === 'OP' && (t.val === '+' || t.val === '-')) {
				this.eat();
				const right = this.mulDiv();
				if (isError(left)) return left;
				if (isError(right)) return right;
				// String concatenation with +
				if (t.val === '+' && (typeof left === 'string' || typeof right === 'string')) {
					left = String(left) + String(right);
				} else {
					const l = toNum(left, '+'); if (isError(l)) return l;
					const r = toNum(right, '+'); if (isError(r)) return r;
					left = t.val === '+' ? l + r : l - r;
				}
			} else break;
		}
		return left;
	}

	private mulDiv(): EvalResult {
		let left = this.unary();
		while (true) {
			const t = this.peek();
			if (t?.type === 'OP' && (t.val === '*' || t.val === '/' || t.val === '^' || t.val === '%')) {
				this.eat();
				const right = this.unary();
				if (isError(left)) return left;
				if (isError(right)) return right;
				const l = toNum(left, t.val); if (isError(l)) return l;
				const r = toNum(right, t.val); if (isError(r)) return r;
				if (t.val === '*') left = l * r;
				else if (t.val === '/') left = r === 0 ? { error: '#DIV/0' } : l / r;
				else if (t.val === '^') left = Math.pow(l, r);
				else if (t.val === '%') left = l % r;
			} else break;
		}
		return left;
	}

	private unary(): EvalResult {
		const t = this.peek();
		if (t?.type === 'OP' && t.val === '-') { this.eat(); const v = this.primary(); const n = toNum(v, '-'); return isError(n) ? n : -n; }
		if (t?.type === 'OP' && t.val === '+') { this.eat(); return this.primary(); }
		return this.primary();
	}

	private primary(): EvalResult {
		const t = this.peek();
		if (!t) return { error: '#EMPTY' };

		if (t.type === 'NUM') { this.eat(); return t.val; }
		if (t.type === 'STR') { this.eat(); return t.val; }

		if (t.type === 'REF') {
			this.eat();
			const ref = parseCellRef(t.val);
			if (!ref) return { error: `#REF: ${t.val}` };
			return coerce(this.getter(ref.row, ref.col), this.getter);
		}

		if (t.type === 'RANGE') {
			this.eat();
			const vals = expandRange(t.val, this.getter);
			const nums = vals.filter((v): v is number => typeof v === 'number');
			return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : 0;
		}

		if (t.type === 'LPAREN') {
			this.eat();
			const v = this.expr();
			const closing = this.peek();
			if (closing?.type === 'RPAREN') this.eat();
			return v;
		}

		if (t.type === 'NAME') {
			this.eat();
			const fnName = t.val.toUpperCase();
			const lp = this.peek();
			if (lp?.type !== 'LPAREN') {
				// Named constants
				if (fnName === 'TRUE') return 1;
				if (fnName === 'FALSE') return 0;
				if (fnName === 'PI') return Math.PI;
				return { error: `#NAME: ${fnName}` };
			}
			this.eat(); // consume '('
			const args = this.argList();
			const rp = this.peek();
			if (rp?.type === 'RPAREN') this.eat();
			return this.callFn(fnName, args);
		}

		this.eat();
		return { error: '#SYNTAX' };
	}

	private argList(): EvalResult[][] {
		// Each arg is either a scalar (EvalResult[1]) or a range expansion (EvalResult[n])
		const args: EvalResult[][] = [];
		if (this.peek()?.type === 'RPAREN') return args;
		while (true) {
			const t = this.peek();
			if (!t || t.type === 'RPAREN') break;
			// Range arg
			if (t.type === 'RANGE') {
				this.eat();
				args.push(expandRange(t.val, this.getter));
			} else {
				args.push([this.expr()]);
			}
			const sep = this.peek();
			if (sep?.type === 'COMMA' || sep?.type === 'SEMI') this.eat();
			else break;
		}
		return args;
	}

	private callFn(name: string, args: EvalResult[][]): EvalResult {
		const flat = args.flat();
		const nums = (): (number | EvalError)[] => flat.map((v) => toNum(v, name));

		switch (name) {
			case 'SUM': {
				const ns = nums(); for (const n of ns) if (isError(n)) return n;
				return (ns as number[]).reduce((a, b) => a + b, 0);
			}
			case 'AVERAGE':
			case 'AVG': {
				const numericOnly = flat.filter((v) => typeof v === 'number' || (!isError(v) && !isNaN(Number(v))));
				if (numericOnly.length === 0) return { error: '#DIV/0' };
				const sum = numericOnly.reduce((a, v) => a + (typeof v === 'number' ? v : Number(v)), 0);
				return sum / numericOnly.length;
			}
			case 'COUNT':
				return flat.filter((v) => !isError(v) && !isNaN(Number(v)) && String(v) !== '').length;
			case 'COUNTA':
				return flat.filter((v) => !isError(v) && String(v) !== '').length;
			case 'MIN': {
				const ns = flat.filter((v): v is number => typeof v === 'number');
				return ns.length === 0 ? 0 : Math.min(...ns);
			}
			case 'MAX': {
				const ns = flat.filter((v): v is number => typeof v === 'number');
				return ns.length === 0 ? 0 : Math.max(...ns);
			}
			case 'ABS': {
				if (flat.length < 1) return { error: '#ARG' };
				const n = toNum(flat[0], 'ABS'); if (isError(n)) return n; return Math.abs(n);
			}
			case 'ROUND': {
				const n = toNum(flat[0] ?? 0, 'ROUND'); if (isError(n)) return n;
				const dp = flat.length > 1 ? toNum(flat[1], 'ROUND') : 0; if (isError(dp)) return dp;
				return Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp);
			}
			case 'FLOOR': {
				const n = toNum(flat[0] ?? 0, 'FLOOR'); if (isError(n)) return n;
				return Math.floor(n);
			}
			case 'CEIL':
			case 'CEILING': {
				const n = toNum(flat[0] ?? 0, 'CEIL'); if (isError(n)) return n;
				return Math.ceil(n);
			}
			case 'SQRT': {
				const n = toNum(flat[0] ?? 0, 'SQRT'); if (isError(n)) return n;
				return n < 0 ? { error: '#NUM' } : Math.sqrt(n);
			}
			case 'POWER': {
				const base = toNum(flat[0] ?? 0, 'POWER'); if (isError(base)) return base;
				const exp = toNum(flat[1] ?? 1, 'POWER'); if (isError(exp)) return exp;
				return Math.pow(base, exp);
			}
			case 'MOD': {
				const a = toNum(flat[0] ?? 0, 'MOD'); if (isError(a)) return a;
				const b = toNum(flat[1] ?? 1, 'MOD'); if (isError(b)) return b;
				return b === 0 ? { error: '#DIV/0' } : a % b;
			}
			case 'IF': {
				const cond = flat[0]; const t = flat[1] ?? 0; const f = flat[2] ?? 0;
				const n = typeof cond === 'number' ? cond : Number(cond);
				return (n !== 0 && !isNaN(n)) ? t : f;
			}
			case 'CONCAT':
			case 'CONCATENATE':
				return flat.filter((v) => !isError(v)).map(String).join('');
			case 'LEN':
				return String(flat[0] ?? '').length;
			case 'UPPER':
				return String(flat[0] ?? '').toUpperCase();
			case 'LOWER':
				return String(flat[0] ?? '').toLowerCase();
			case 'TRIM':
				return String(flat[0] ?? '').trim();
			default:
				return { error: `#NAME: ${name}` };
		}
	}
}

/** Main entry. rawCellValue should start with '='. Returns display string. */
export function evaluateFormula(rawCellValue: string, getter: CellGetter): EvalResult {
	if (!rawCellValue.startsWith('=')) return rawCellValue;
	const expr = rawCellValue.slice(1).trim();
	if (!expr) return '';
	try {
		const tokens = tokenise(expr);
		const parser = new Parser(tokens, getter);
		return parser.parse();
	} catch (e) {
		return { error: `#ERROR` };
	}
}

/** Format a cell value for display. Errors show their code. Numbers show up to 10 sig-figs. */
export function displayValue(raw: string, getter: CellGetter): string {
	if (!raw) return '';
	if (!raw.startsWith('=')) return raw;
	const result = evaluateFormula(raw, getter);
	if (isError(result)) return result.error;
	if (typeof result === 'number') {
		// Avoid scientific notation for reasonable values
		return parseFloat(result.toPrecision(10)).toString();
	}
	return String(result);
}
