import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useTui } from '../context.js';
import { initYjs } from '../store.js';

export function LoginView({ serverUrl, wsUrl, insecure }: { serverUrl: string, wsUrl: string, insecure: boolean }) {
	const { setView, setUsername, setYDoc } = useTui();

	const [step, setStep] = useState<'user' | 'pass' | 'connecting'>('user');
	const [user, setUser] = useState('');
	const [pass, setPass] = useState('');
	const [error, setError] = useState('');

	const handleLogin = async () => {
		try {
			setError('');
			setStep('connecting');
			const res = await fetch(`${serverUrl}/api/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: user, password: pass })
			});
			if (!res.ok) {
				const body = await res.json() as any;
				throw new Error(body.error || 'Login failed');
			}
			const setCookieHeader = res.headers.get('set-cookie');
			if (!setCookieHeader) throw new Error('No cookie returned');
			
			const sessionCookie = setCookieHeader.split(';')[0];

			const doc = initYjs(user, wsUrl, sessionCookie, insecure, () => {
				// handled by useYjsUpdate now
			});
			
			setYDoc(doc);
			setUsername(user);
			setView('home');
		} catch (err: any) {
			setError(err.message);
			setStep('user');
		}
	};

	if (step === 'connecting') {
		return <Box padding={1}><Text color="yellow">Connecting...</Text></Box>;
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Text color="cyan" bold>Please Log In</Text>
			<Box marginTop={1}>
				<Text>Username: </Text>
				{step === 'user' ? (
					<TextInput 
						value={user} 
						onChange={setUser} 
						onSubmit={() => { if (user) setStep('pass'); }} 
					/>
				) : (
					<Text>{user}</Text>
				)}
			</Box>
			{step === 'pass' && (
				<Box>
					<Text>Password: </Text>
					<TextInput 
						value={pass} 
						onChange={setPass} 
						mask="*" 
						onSubmit={handleLogin} 
					/>
				</Box>
			)}
			{error && <Text color="red">Error: {error}</Text>}
		</Box>
	);
}
