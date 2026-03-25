import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createMachine } from '../src/index';

const makeAuthMachine = () => createMachine({
	initialStep: 'unlogged' as const,
	state: { email: '' },
	transitions: (action) => ({
		unlogged: {
			LOGIN: action(
				z.object({ email: z.email() }),
				(_s, data) => ({ step: 'logged' as const, state: { email: data.email } })
			),
		},
		logged: {
			LOGOUT: action(
				z.void(),
				(_s, _d) => ({ step: 'unlogged' as const, state: { email: '' } })
			),
		},
	}),
});

describe('createMachine', () => {
	describe('initial state', () => {
		it('starts at the configured initial step', () => {
			const m = makeAuthMachine();
			expect(m.initialStep).toBe('unlogged');
		});

		it('starts with the configured initial state', () => {
			const m = makeAuthMachine();
			expect(m.state).toEqual({ email: '' });
		});
	});

	describe('valid transitions', () => {
		it('LOGIN transitions step to logged', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGIN', { email: 'user@example.com' });
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.initialStep).toBe('logged');
		});

		it('LOGIN carries the email into state', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGIN', { email: 'user@example.com' });
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.state).toEqual({ email: 'user@example.com' });
		});

		it('LOGOUT transitions step back to unlogged', () => {
			const m = makeAuthMachine();
			const loggedResult = m.dispatch('LOGIN', { email: 'user@example.com' });
			expect(loggedResult.success).toBe(true);
			if (!loggedResult.success) return;

			const logoutResult = loggedResult.data.dispatch('LOGOUT', undefined);
			expect(logoutResult.success).toBe(true);
			if (logoutResult.success) expect(logoutResult.data.initialStep).toBe('unlogged');
		});

		it('LOGOUT clears state', () => {
			const m = makeAuthMachine();
			const loggedResult = m.dispatch('LOGIN', { email: 'user@example.com' });
			if (!loggedResult.success) return;

			const logoutResult = loggedResult.data.dispatch('LOGOUT', undefined);
			expect(logoutResult.success).toBe(true);
			if (logoutResult.success) expect(logoutResult.data.state).toEqual({ email: '' });
		});
	});

	describe('invalid actions', () => {
		it('LOGOUT fails when unlogged', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGOUT', undefined);
			expect(result.success).toBe(false);
		});

		it('LOGIN fails when already logged in', () => {
			const m = makeAuthMachine();
			const loggedResult = m.dispatch('LOGIN', { email: 'user@example.com' });
			if (!loggedResult.success) return;

			const result = loggedResult.data.dispatch('LOGIN', { email: 'other@example.com' });
			expect(result.success).toBe(false);
		});

		it('returns failure for completely unknown action', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('UNKNOWN_ACTION' as any, undefined);
			expect(result.success).toBe(false);
		});
	});

	describe('input validation', () => {
		it('LOGIN with invalid email returns failure', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGIN', { email: 'not-an-email' });
			expect(result.success).toBe(false);
		});

		it('LOGIN with missing email returns failure', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGIN', {});
			expect(result.success).toBe(false);
		});

		it('LOGIN with no payload returns failure', () => {
			const m = makeAuthMachine();
			const result = m.dispatch('LOGIN', undefined);
			expect(result.success).toBe(false);
		});
	});

	describe('immutability', () => {
		it('dispatching does not mutate the original machine', () => {
			const m = makeAuthMachine();
			m.dispatch('LOGIN', { email: 'user@example.com' });
			expect(m.initialStep).toBe('unlogged');
		});

		it('chained dispatches produce independent machines', () => {
			const m = makeAuthMachine();
			const r1 = m.dispatch('LOGIN', { email: 'a@example.com' });
			const r2 = m.dispatch('LOGIN', { email: 'b@example.com' });
			expect(r1.success).toBe(true);
			expect(r2.success).toBe(true);
			if (r1.success && r2.success) {
				expect(r1.data.state).toEqual({ email: 'a@example.com' });
				expect(r2.data.state).toEqual({ email: 'b@example.com' });
			}
		});
	});
});
