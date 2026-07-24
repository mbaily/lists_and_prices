import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useItems, useLists } from '../hooks.js';
import { useTui } from '../context.js';

export function ListView({ listId, isFocused }: { listId: string, isFocused: boolean }) {
	const items = useItems(listId);
	const lists = useLists();
	const list = lists.find((l: any) => l.get('id') === listId);
	const { setView } = useTui();

	const [selectedIndex, setSelectedIndex] = useState(0);

	useInput((input, key) => {
		if (!isFocused) return;

		if (key.escape || input === 'h' || key.leftArrow) {
			setView('home');
			return;
		}

		if (items.length === 0) return;

		if (key.upArrow || input === 'k') {
			setSelectedIndex(i => Math.max(0, i - 1));
		} else if (key.downArrow || input === 'j') {
			setSelectedIndex(i => Math.min(items.length - 1, i + 1));
		} else if (input === ' ' || key.return) {
			setSelectedIndex(currentIndex => {
				const selectedItem = items[currentIndex];
				if (selectedItem) {
					const current = selectedItem.get('checked');
					selectedItem.set('checked', !current);
				}
				return currentIndex;
			});
		}
	});

	if (!list) return <Text color="red">List not found</Text>;

	return (
		<Box flexDirection="column" paddingX={2} paddingTop={1} flexGrow={1}>
			<Text bold color="cyan" marginBottom={1}>{list.get('name')}</Text>
			
			{items.length === 0 ? <Text dimColor>No items in this list.</Text> : null}
			
			{items.map((itemObj: any, index: number) => {
				const isChecked = itemObj.get('checked');
				const name = itemObj.get('name');
				const isSelected = index === selectedIndex;

				return (
					<Box key={itemObj.get('id')} paddingLeft={0}>
						<Text 
							color={isSelected ? 'yellow' : (isChecked ? 'green' : 'white')} 
							backgroundColor={isSelected ? 'gray' : undefined} 
							bold={isSelected}
						>
							{isSelected ? '> ' : '  '}{isChecked ? '[x] ' : '[ ] '}{name}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}
