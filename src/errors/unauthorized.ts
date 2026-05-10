/**
 * Thrown when the backend responds 401 Unauthorized (missing or expired JWT).
 */

export class UnauthorizedApiError extends Error {
	readonly code = 'UNAUTHORIZED_API';

	constructor(message = 'Your session expired. Please sign in again.') {
		super(message);
		this.name = 'UnauthorizedApiError';
	}
}
