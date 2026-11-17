/** A minimal XML-RPC client: enough for DokuWiki's remote API. */

export type XmlRpcValue = string | number | boolean | null | XmlRpcValue[] | { [key: string]: XmlRpcValue };

export class XmlRpcFault extends Error {
	constructor(readonly code: number, message: string) { super(message); }
}

export class HttpError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function encodeValue(value: XmlRpcValue): string {
	if (value === null) return '<value><nil/></value>';
	if (typeof value === 'string') return `<value><string>${escapeXml(value)}</string></value>`;
	if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
	if (typeof value === 'number') return Number.isInteger(value) ? `<value><int>${value}</int></value>` : `<value><double>${value}</double></value>`;
	if (Array.isArray(value)) return `<value><array><data>${value.map(encodeValue).join('')}</data></array></value>`;
	return `<value><struct>${Object.entries(value).map(([name, member]) => `<member><name>${escapeXml(name)}</name>${encodeValue(member)}</member>`).join('')}</struct></value>`;
}

export function encodeCall(method: string, params: XmlRpcValue[]): string {
	return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${params.map((param) => `<param>${encodeValue(param)}</param>`).join('')}</params></methodCall>`;
}

const unescapeXml = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
	const lower = entity.toLowerCase();
	if (lower === 'lt') return '<';
	if (lower === 'gt') return '>';
	if (lower === 'amp') return '&';
	if (lower === 'quot') return '"';
	if (lower === 'apos') return "'";
	return String.fromCodePoint(lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10));
});

/** Tokenizes the response; XML-RPC needs no attributes, namespaces or mixed content. */
class Reader {
	private tokens: { tag?: string; close?: boolean; selfClose?: boolean; text?: string }[] = [];
	private pos = 0;
	constructor(xml: string) {
		const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
		const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z0-9_.:-]+)[^>]*?(\/?)>|([^<]+)/g;
		for (const match of body.matchAll(pattern)) {
			if (match[1] !== undefined) this.tokens.push({ text: match[1] });
			else if (match[3]) this.tokens.push({ tag: match[3], close: match[2] === '/', selfClose: match[4] === '/' });
			else this.tokens.push({ text: unescapeXml(match[5]) });
		}
	}
	private skipSpace() {
		while (this.pos < this.tokens.length && this.tokens[this.pos].text !== undefined && !this.tokens[this.pos].text!.trim()) this.pos++;
	}
	peekTag(): string | undefined { this.skipSpace(); const token = this.tokens[this.pos]; return token?.tag && !token.close ? token.tag : undefined; }
	open(tag: string): boolean {
		this.skipSpace();
		const token = this.tokens[this.pos];
		if (!token || token.tag !== tag || token.close) throw new Error(`Malformed XML-RPC response: expected <${tag}>`);
		this.pos++;
		return Boolean(token.selfClose);
	}
	close(tag: string) {
		this.skipSpace();
		const token = this.tokens[this.pos];
		if (!token || token.tag !== tag || !token.close) throw new Error(`Malformed XML-RPC response: expected </${tag}>`);
		this.pos++;
	}
	atClose(tag: string): boolean { this.skipSpace(); const token = this.tokens[this.pos]; return Boolean(token?.close && token.tag === tag); }
	text(): string {
		let out = '';
		while (this.pos < this.tokens.length && this.tokens[this.pos].text !== undefined) out += this.tokens[this.pos++].text;
		return out;
	}
}

function readValue(reader: Reader): XmlRpcValue {
	if (reader.open('value')) return '';
	const type = reader.peekTag();
	if (!type) {
		const text = reader.text();
		reader.close('value');
		return text;
	}
	const empty = reader.open(type);
	let result: XmlRpcValue;
	switch (type) {
		case 'string': case 'dateTime.iso8601': case 'base64':
			result = empty ? '' : reader.text(); break;
		case 'int': case 'i4': case 'i8': case 'double':
			result = Number(reader.text().trim()); break;
		case 'boolean':
			result = reader.text().trim() === '1'; break;
		case 'nil':
			result = null; break;
		case 'array': {
			const items: XmlRpcValue[] = [];
			if (!empty) {
				const dataEmpty = reader.open('data');
				if (!dataEmpty) {
					while (!reader.atClose('data')) items.push(readValue(reader));
					reader.close('data');
				}
			}
			result = items;
			break;
		}
		case 'struct': {
			const struct: Record<string, XmlRpcValue> = {};
			if (!empty) {
				while (!reader.atClose('struct')) {
					reader.open('member');
					reader.open('name');
					const name = reader.text().trim();
					reader.close('name');
					struct[name] = readValue(reader);
					reader.close('member');
				}
			}
			result = struct;
			break;
		}
		default:
			throw new Error(`Unsupported XML-RPC type ${type}`);
	}
	if (!empty) reader.close(type);
	reader.close('value');
	return result;
}

export function decodeResponse(xml: string): XmlRpcValue {
	const reader = new Reader(xml);
	reader.open('methodResponse');
	if (reader.peekTag() === 'fault') {
		reader.open('fault');
		const fault = readValue(reader) as { faultCode?: number; faultString?: string };
		throw new XmlRpcFault(Number(fault?.faultCode ?? 0), String(fault?.faultString ?? 'XML-RPC fault'));
	}
	reader.open('params');
	reader.open('param');
	const value = readValue(reader);
	return value;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

export async function xmlRpcCall(fetcher: FetchLike, url: string, method: string, params: XmlRpcValue[], headers: Record<string, string> = {}, timeoutMs = 30_000): Promise<XmlRpcValue> {
	const response = await fetcher(url, {
		method: 'POST',
		headers: { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml', ...headers },
		body: encodeCall(method, params),
		signal: AbortSignal.timeout(timeoutMs)
	});
	const body = await response.text();
	// DokuWiki answers auth failures with an HTTP error *and* a fault body.
	if (body.includes('<methodResponse')) {
		try { return decodeResponse(body); }
		catch (error) { if (error instanceof XmlRpcFault || response.ok) throw error; }
	}
	if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`.trim());
	throw new Error('DokuWiki did not return an XML-RPC response. Is the remote API enabled?');
}
