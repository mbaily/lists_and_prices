import React from 'react';
import { TuiProvider } from './context.js';
import { AppRouter } from './AppRouter.js';

export function App({ serverUrl, wsUrl, insecure = false }: { serverUrl: string, wsUrl: string, insecure?: boolean }) {
	return (
		<TuiProvider>
			<AppRouter serverUrl={serverUrl} wsUrl={wsUrl} insecure={insecure} />
		</TuiProvider>
	);
}
