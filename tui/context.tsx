import React, { createContext, useContext, useState, useMemo } from 'react';
import * as Y from 'yjs';

interface TuiState {
	view: 'login' | 'home' | 'list' | 'spreadsheet' | 'settings';
	selectedListId: string | null;
	selectedFolderId: string | null;
	username: string;
	yDoc: Y.Doc | null;
}

interface TuiContextType extends TuiState {
	setView: (view: TuiState['view']) => void;
	setSelectedListId: (id: string | null) => void;
	setSelectedFolderId: (id: string | null) => void;
	setUsername: (name: string) => void;
	setYDoc: (doc: Y.Doc | null) => void;
}

const TuiContext = createContext<TuiContextType | undefined>(undefined);

export function TuiProvider({ children }: { children: React.ReactNode }) {
	const [view, setView] = useState<TuiState['view']>('login');
	const [selectedListId, setSelectedListId] = useState<string | null>(null);
	const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
	const [username, setUsername] = useState('');
	const [yDoc, setYDoc] = useState<Y.Doc | null>(null);

	const value = useMemo(() => ({
		view, setView,
		selectedListId, setSelectedListId,
		selectedFolderId, setSelectedFolderId,
		username, setUsername,
		yDoc, setYDoc
	}), [view, selectedListId, selectedFolderId, username, yDoc]);

	return <TuiContext.Provider value={value}>{children}</TuiContext.Provider>;
}

export function useTui() {
	const context = useContext(TuiContext);
	if (!context) throw new Error('useTui must be used within a TuiProvider');
	return context;
}
