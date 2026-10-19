import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export function encodeSyncMessage(username: string, vector: Uint8Array, update: Uint8Array = new Uint8Array()): Uint8Array<ArrayBuffer> {
	const encoder = encoding.createEncoder();
	encoding.writeVarString(encoder, username);
	encoding.writeVarUint8Array(encoder, vector);
	encoding.writeVarUint8Array(encoder, update);
	return new Uint8Array(encoding.toUint8Array(encoder));
}

export function decodeSyncMessage(bytes: Uint8Array) {
	const decoder = decoding.createDecoder(bytes);
	const username = decoding.readVarString(decoder);
	const vector = decoding.readVarUint8Array(decoder);
	const update = decoding.readVarUint8Array(decoder);
	if (decoding.hasContent(decoder)) throw new Error('Unexpected sync data');
	return { username, vector, update };
}
