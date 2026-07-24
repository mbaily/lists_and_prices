import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useFolders, useLists } from '../hooks.js';
import { useTui } from '../context.js';

export function HomeView() {
	const folders = useFolders();
	const lists = useLists();
	const { setSelectedListId, setView } = useTui();

	const [selectedIndex, setSelectedIndex] = useState(0);

	useInput((input, key) => {
		if (lists.length === 0) return;

		if (key.upArrow || input === 'k') {
			setSelectedIndex(i => Math.max(0, i - 1));
		} else if (key.downArrow || input === 'j') {
			setSelectedIndex(i => Math.min(lists.length - 1, i + 1));
		} else if (key.return || input === 'l' || key.rightArrow || input === ' ') {
			const selectedList = lists[selectedIndex];
			if (selectedList) {
				setSelectedListId(selectedList.get('id'));
				setView('list');
			}
		}
	});

	return (
		<Box flexDirection="column" paddingX={2} paddingTop={1} flexGrow={1}>
			<Text bold color="cyan" marginBottom={1}>Your Lists</Text>
			{lists.length === 0 ? <Text dimColor>No lists found.</Text> : null}
			{lists.map((listObj: any, index: number) => {
				const isSelected = index === selectedIndex;
				return (
					<Text 
						key={listObj.get('id')} 
						color={isSelected ? 'yellow' : 'white'}
						backgroundColor={isSelected ? 'gray' : undefined}
						bold={isSelected}
					>
						{isSelected ? '> ' : '  '}{listObj.get('name')}
					</Text>
				);
			})}
		</Box>
	);
}
