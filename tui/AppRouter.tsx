import React from 'react';
import { Box, Text } from 'ink';
import { useTui } from './context.js';
import { LoginView } from './views/LoginView.js';
import { HomeView } from './views/HomeView.js';

import { ListView } from './views/ListView.js';

export function AppRouter({ serverUrl, wsUrl, insecure }: { serverUrl: string, wsUrl: string, insecure: boolean }) {
	const { view, username, selectedListId } = useTui();

	let content = null;

	switch (view) {
		case 'login':
			content = <LoginView serverUrl={serverUrl} wsUrl={wsUrl} insecure={insecure} />;
			break;
		case 'home':
			content = <HomeView />;
			break;
		case 'list':
			if (selectedListId) {
				content = <ListView listId={selectedListId} isFocused={true} />;
			} else {
				content = <Text>No list selected</Text>;
			}
			break;
		default:
			content = <Text>Unknown view: {view}</Text>;
	}

	return (
		<Box flexDirection="column" height="100%" minHeight={20}>
			{/* Header */}
			<Box borderStyle="single" paddingX={1} borderColor="cyan">
				<Text bold color="cyan">Lists & Prices</Text>
				<Box flexGrow={1} />
				{username ? <Text>User: {username}</Text> : null}
			</Box>

			{/* Main Content */}
			<Box flexGrow={1} flexDirection="column">
				{content}
			</Box>

			{/* Status Bar */}
			<Box borderStyle="single" paddingX={1} borderColor="gray" minHeight={3}>
				<Text dimColor>Status: {username ? 'Synced' : 'Offline'}</Text>
				<Box flexGrow={1} />
				<Text dimColor>[?] Help  [Ctrl+C] Quit</Text>
			</Box>
		</Box>
	);
}
