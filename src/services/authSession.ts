/**
 * Persisted IntelliTest account session (JWT) for the VS Code extension.
 */

import axios from 'axios';
import type * as vscode from 'vscode';
import { UnauthorizedApiError } from '../errors/unauthorized.js';

export const AUTH_TOKEN_SECRET_KEY = 'intellitest.authJwt';

export type AuthUserPayload = {
	id: string;
	name: string;
	email: string;
};

export async function getStoredToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	const t = await context.secrets.get(AUTH_TOKEN_SECRET_KEY);
	return t?.trim() ? t.trim() : undefined;
}

export async function saveToken(context: vscode.ExtensionContext, token: string): Promise<void> {
	await context.secrets.store(AUTH_TOKEN_SECRET_KEY, token.trim());
}

export async function clearStoredToken(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(AUTH_TOKEN_SECRET_KEY);
}

function normalizeBase(baseUrl: string): string {
	return baseUrl.replace(/\/$/, '');
}

function authErrorMessage(err: unknown): string {
	if (!axios.isAxiosError(err) || err.response?.data == null || typeof err.response.data !== 'object') {
		return err instanceof Error ? err.message : 'Authentication failed.';
	}
	const d = err.response.data as Record<string, unknown>;
	const m = d.message ?? d.detail ?? d.error;
	if (typeof m === 'string' && m.trim()) {
		return m.trim();
	}
	if (m != null && typeof m === 'object' && 'message' in m && typeof (m as { message: unknown }).message === 'string') {
		const mm = (m as { message: string }).message;
		if (mm.trim()) return mm.trim();
	}
	return 'Authentication failed.';
}

export async function loginRequest(
	baseUrl: string,
	email: string,
	password: string
): Promise<{ token: string; user: AuthUserPayload }> {
	const root = normalizeBase(baseUrl);
	try {
		const res = await axios.post<{ token: string; user: AuthUserPayload }>(
			`${root}/auth/login`,
			{ email: email.trim(), password },
			{ timeout: 15_000, headers: { 'Content-Type': 'application/json' } }
		);
		const token = res.data?.token;
		const user = res.data?.user;
		if (!token?.trim() || !user?.id) {
			throw new Error('Invalid login response from server.');
		}
		return { token: token.trim(), user };
	} catch (err) {
		if (axios.isAxiosError(err) && err.response?.status === 401) {
			throw new Error('Invalid email or password.');
		}
		if (axios.isAxiosError(err) && err.response?.status === 503) {
			throw new Error(
				'The IntelliTest server cannot reach its database. Fix MONGODB_URI on the server, allow your IP in Atlas, and restart the server.'
			);
		}
		throw new Error(authErrorMessage(err));
	}
}

export async function signupRequest(
	baseUrl: string,
	name: string,
	email: string,
	password: string
): Promise<{ token: string; user: AuthUserPayload }> {
	const root = normalizeBase(baseUrl);
	try {
		const res = await axios.post<{ token: string; user: AuthUserPayload }>(
			`${root}/auth/signup`,
			{
				name: name.trim(),
				email: email.trim(),
				password
			},
			{ timeout: 15_000, headers: { 'Content-Type': 'application/json' } }
		);
		const token = res.data?.token;
		const user = res.data?.user;
		if (!token?.trim() || !user?.id) {
			throw new Error('Invalid sign-up response from server.');
		}
		return { token: token.trim(), user };
	} catch (err) {
		if (axios.isAxiosError(err) && err.response?.status === 503) {
			throw new Error(
				'The IntelliTest server cannot reach its database. Fix MONGODB_URI on the server, allow your IP in Atlas, and restart the server.'
			);
		}
		throw new Error(authErrorMessage(err));
	}
}

/**
 * Validates the JWT with GET /auth/me. Returns undefined if unauthorized.
 */
export async function fetchSessionUser(
	baseUrl: string,
	token: string
): Promise<AuthUserPayload | undefined> {
	const root = normalizeBase(baseUrl);
	try {
		const res = await axios.get<{ user: AuthUserPayload }>(`${root}/auth/me`, {
			timeout: 10_000,
			headers: { Authorization: `Bearer ${token}` }
		});
		const user = res.data?.user;
		if (!user?.id) {
			return undefined;
		}
		return {
			id: String(user.id),
			name: String(user.name ?? ''),
			email: String(user.email ?? '')
		};
	} catch (err) {
		if (axios.isAxiosError(err) && err.response?.status === 401) {
			return undefined;
		}
		if (axios.isAxiosError(err) && err.response?.status === 503) {
			throw new Error(
				'The IntelliTest server cannot reach its database. Fix MONGODB_URI on the server, allow your IP in Atlas, and restart the server.'
			);
		}
		throw err instanceof Error ? err : new Error(String(err));
	}
}

/** Re-throw UnauthorizedApiError from axios failures when status is 401. */
export function rethrowAxiosUnauthorized(err: unknown): void {
	if (axios.isAxiosError(err) && err.response?.status === 401) {
		throw new UnauthorizedApiError();
	}
}
