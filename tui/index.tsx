import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { parseArgs } from 'node:util';
import fs from 'node:fs';

const { values } = parseArgs({
	options: {
		config: {
			type: 'string',
			short: 'c'
		}
	},
	strict: false
});

let hostname = 'localhost';
let port = 8080;
let tls = false;
let insecure = false;

if (values.config) {
	try {
		const configStr = fs.readFileSync(values.config, 'utf8');
		const config = JSON.parse(configStr);
		if (config.hostname) hostname = config.hostname;
		if (config.port) port = config.port;
		if (config.tls !== undefined) tls = config.tls;
		if (config.insecure !== undefined) insecure = config.insecure;
	} catch (e: any) {
		console.error(`Failed to load config file: ${e.message}`);
		process.exit(1);
	}
}

if (tls && hostname === 'localhost' && !('insecure' in (values.config ? JSON.parse(fs.readFileSync(values.config, 'utf8')) : {}))) {
	insecure = true;
}

if (insecure) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const originalEmit = process.emit;
	process.emit = function (name: any, data: any, ...args: any[]) {
		if (name === 'warning' && typeof data === 'object' && data.name === 'Warning' && data.message.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
			return false;
		}
		return originalEmit.apply(process, [name, data, ...args] as any);
	} as any;
}

const serverUrl = `${tls ? 'https' : 'http'}://${hostname}:${port}`;
const wsUrl = `${tls ? 'wss' : 'ws'}://${hostname}:${port}/yjs`;

render(<App serverUrl={serverUrl} wsUrl={wsUrl} insecure={insecure} />);
