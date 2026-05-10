/**
 * projectId utility — generates and persists a stable projectId per workspace.
 *
 * Strategy (two-level):
 *   1. Check extensionContext.workspaceState for a stored UUID (survives restarts).
 *   2. If none, generate a new UUID v4 and store it.
 *
 * The UUID is scoped to the workspace (workspaceState), so different projects
 * opened in the same VS Code install get different IDs.
 *
 * Callers should pass the ExtensionContext so the ID survives extension restarts.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

const STORAGE_KEY = 'debuggo.projectId';
/** Previous key — migrated once so upgrading from the IntelliTest-named extension keeps the same backend project id in dev/local scenarios. */
const LEGACY_STORAGE_KEY = 'intellitest.projectId';

/**
 * Returns a stable projectId for the current workspace.
 * Creates and persists one if it doesn't exist yet.
 *
 * @param context — VS Code ExtensionContext (provides workspaceState)
 */
export function getOrCreateProjectId(context: vscode.ExtensionContext): string {
	let stored = context.workspaceState.get<string>(STORAGE_KEY);
	if (stored && isValidProjectId(stored)) {
		return stored;
	}

	const legacy = context.workspaceState.get<string>(LEGACY_STORAGE_KEY);
	if (legacy && isValidProjectId(legacy)) {
		void context.workspaceState.update(STORAGE_KEY, legacy);
		void context.workspaceState.update(LEGACY_STORAGE_KEY, undefined);
		return legacy;
	}

	const newId = generateUUID();
	// Fire-and-forget; the ID is immediately usable
	void context.workspaceState.update(STORAGE_KEY, newId);
	return newId;
}

/**
 * Force-reset the projectId for the current workspace.
 * Useful for "Start fresh session" commands.
 */
export async function resetProjectId(context: vscode.ExtensionContext): Promise<string> {
	const newId = generateUUID();
	await context.workspaceState.update(STORAGE_KEY, newId);
	return newId;
}

// ── helpers ────────────────────────────────────────────────────────────────────

/** UUID v4 using Node's crypto module (available in VS Code extension host). */
function generateUUID(): string {
	return crypto.randomUUID();
}

/** Matches the same regex as the server's validateGenerate middleware. */
function isValidProjectId(id: string): boolean {
	return /^[a-zA-Z0-9\-_.]{6,128}$/.test(id);
}
