import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import {
	getSimpleTodoSetting,
	resolveSimpleTodoBaseUrl,
	simpleTodoPageUrl,
	simpleTodoApiUrl
} from '../src/lib/simpleTodo.ts';

test('defaults to sibling relative reference when no environment variable is set', () => {
	strictEqual(resolveSimpleTodoBaseUrl('', ''), '/../simple_todo');
	strictEqual(resolveSimpleTodoBaseUrl('', '/lists'), '/lists/../simple_todo');

	strictEqual(simpleTodoPageUrl('bills', '', ''), '/../simple_todo/bills');
	strictEqual(simpleTodoPageUrl('bills', '/lists', ''), '/lists/../simple_todo/bills');
	strictEqual(simpleTodoPageUrl('calendar', '', ''), '/../simple_todo/calendar');
	strictEqual(simpleTodoPageUrl('calendar', '/lists', ''), '/lists/../simple_todo/calendar');

	const billsApi = simpleTodoApiUrl('api/bills?show_inactive=1', '', {
		configuredUrl: '',
		origin: 'http://localhost:8080'
	});
	strictEqual(billsApi.href, 'http://localhost:8080/simple_todo/api/bills?show_inactive=1');

	const calendarApi = simpleTodoApiUrl('api/calendar/events', '/lists', {
		configuredUrl: '',
		origin: 'https://example.com'
	});
	strictEqual(calendarApi.href, 'https://example.com/simple_todo/api/calendar/events');
});

test('resolves absolute URLs for pages and APIs', () => {
	const absolute = 'https://todo.example.com';
	strictEqual(resolveSimpleTodoBaseUrl(absolute), 'https://todo.example.com');
	strictEqual(resolveSimpleTodoBaseUrl(`${absolute}/`), 'https://todo.example.com');

	strictEqual(simpleTodoPageUrl('bills', '', absolute), 'https://todo.example.com/bills');
	strictEqual(simpleTodoPageUrl('calendar', '', `${absolute}/`), 'https://todo.example.com/calendar');

	const billsApi = simpleTodoApiUrl('api/bills?show_inactive=1', '', {
		configuredUrl: absolute,
		origin: 'https://lists.example.com'
	});
	strictEqual(billsApi.href, 'https://todo.example.com/api/bills?show_inactive=1');

	const calendarApi = simpleTodoApiUrl('api/calendar/events', '', {
		configuredUrl: `${absolute}/sub/`,
		origin: 'https://lists.example.com'
	});
	strictEqual(calendarApi.href, 'https://todo.example.com/sub/api/calendar/events');
});

test('resolves custom root-relative paths', () => {
	const customPath = '/custom_todo';
	strictEqual(simpleTodoPageUrl('bills', '/lists', customPath), '/custom_todo/bills');
	strictEqual(simpleTodoPageUrl('calendar', '/lists', `${customPath}/`), '/custom_todo/calendar');

	const api = simpleTodoApiUrl('api/bills?show_inactive=1', '/lists', {
		configuredUrl: customPath,
		origin: 'https://example.com'
	});
	strictEqual(api.href, 'https://example.com/custom_todo/api/bills?show_inactive=1');
});

test('resolves custom relative paths', () => {
	const relPath = '../other_todo';
	strictEqual(simpleTodoPageUrl('bills', '', relPath), '../other_todo/bills');

	const api = simpleTodoApiUrl('api/calendar/events', '', {
		configuredUrl: relPath,
		origin: 'http://localhost:3000'
	});
	strictEqual(api.href, 'http://localhost:3000/other_todo/api/calendar/events');
});

test('reads from SIMPLE_TODO_URL and PUBLIC_SIMPLE_TODO_URL environment variables', () => {
	const origSimple = process.env.SIMPLE_TODO_URL;
	const origPublic = process.env.PUBLIC_SIMPLE_TODO_URL;

	try {
		delete process.env.SIMPLE_TODO_URL;
		delete process.env.PUBLIC_SIMPLE_TODO_URL;
		strictEqual(getSimpleTodoSetting(), '');

		process.env.PUBLIC_SIMPLE_TODO_URL = 'https://public-todo.example.com';
		strictEqual(getSimpleTodoSetting(), 'https://public-todo.example.com');

		process.env.SIMPLE_TODO_URL = 'https://todo.example.com';
		strictEqual(getSimpleTodoSetting(), 'https://todo.example.com');
	} finally {
		if (origSimple !== undefined) process.env.SIMPLE_TODO_URL = origSimple;
		else delete process.env.SIMPLE_TODO_URL;
		if (origPublic !== undefined) process.env.PUBLIC_SIMPLE_TODO_URL = origPublic;
		else delete process.env.PUBLIC_SIMPLE_TODO_URL;
	}
});

