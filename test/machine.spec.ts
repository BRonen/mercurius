import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createInvariants } from '../src/index';

const authWorkflow = createInvariants({
	unlogged: z.object({ email: z.null() }),
	logged: z.object({ email: z.email() }),
}).defineWorkflow({
	unlogged: {
		on: {
			LOGIN: (action) => action(
				z.email(),
				(_s, data) => ({ success: true, data: { step: 'logged' as const, state: { email: data } } })
			)
		}
	},
	logged: {
		on: {
			LOGOUT: (action) => action(
				z.void(),
				(_s, _d) => ({ success: true, data: { step: 'unlogged' as const, state: { email: null } } })
			)
		}
	}
}).setup({
	step: 'unlogged',
	state: { email: null }
});

const counterWorkflow = createInvariants({ default: z.number() })
	.defineWorkflow({
		default: {
			on: {
				INC: (action) => action(
					z.void(),
					(state, _d) => ({ success: true, data: { state: state + 1 } })
				),
				DEC: (action) => action(
					z.void(),
					(state, _d) => ({ success: true, data: { state: state - 1 } })
				)
			}
		},
	}).setup({
		step: 'default',
		state: 0
	});

describe('authWorkflow', () => {
	describe('initial state', () => {
		it('starts at the unlogged step', () => {
			expect(authWorkflow.current.step).toBe('unlogged');
		});

		it('starts with null email', () => {
			expect(authWorkflow.current.state).toEqual({ email: null });
		});
	});

	describe('valid transitions', () => {
		it('LOGIN transitions to the logged step', () => {
			const result = authWorkflow.dispatch('LOGIN', 'user@example.com');
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.current.step).toBe('logged');
		});

		it('LOGIN sets the email in state', () => {
			const result = authWorkflow.dispatch('LOGIN', 'user@example.com');
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.current.state).toEqual({ email: 'user@example.com' });
		});

		it('LOGOUT transitions back to unlogged', () => {
			const loginResult = authWorkflow.dispatch('LOGIN', 'user@example.com');
			expect(loginResult.success).toBe(true);
			if (!loginResult.success) return;

			const logoutResult = loginResult.data.dispatch('LOGOUT', undefined);
			expect(logoutResult.success).toBe(true);
			if (logoutResult.success) expect(logoutResult.data.current.step).toBe('unlogged');
		});

		it('LOGOUT clears the email in state', () => {
			const loginResult = authWorkflow.dispatch('LOGIN', 'user@example.com');
			if (!loginResult.success) return;

			const logoutResult = loginResult.data.dispatch('LOGOUT', undefined);
			expect(logoutResult.success).toBe(true);
			if (logoutResult.success) expect(logoutResult.data.current.state).toEqual({ email: null });
		});

		it('full cycle: LOGIN → LOGOUT → LOGIN', () => {
			const r1 = authWorkflow.dispatch('LOGIN', 'user@example.com');
			if (!r1.success) return;

			const r2 = r1.data.dispatch('LOGOUT', undefined);
			if (!r2.success) return;

			const r3 = r2.data.dispatch('LOGIN', 'other@example.com');
			expect(r3.success).toBe(true);
			if (r3.success) expect(r3.data.current.step).toBe('logged');
		});
	});

	describe('input validation', () => {
		it('LOGIN with invalid email returns failure', () => {
			const result = authWorkflow.dispatch('LOGIN', 'not-an-email');
			expect(result.success).toBe(false);
		});

		it('LOGIN with no input returns failure', () => {
			const result = authWorkflow.dispatch('LOGIN', undefined);
			expect(result.success).toBe(false);
		});
	});

	describe('invalid actions', () => {
		it('LOGOUT when unlogged throws', () => {
			expect(() => authWorkflow.dispatch('LOGOUT' as any, undefined)).toThrow();
		});

		it('LOGIN when already logged throws', () => {
			const loginResult = authWorkflow.dispatch('LOGIN', 'user@example.com');
			if (!loginResult.success) return;
			expect(() => loginResult.data.dispatch('LOGIN' as any, 'other@example.com')).toThrow();
		});
	});

	describe('immutability', () => {
		it('dispatching does not mutate the original workflow', () => {
			authWorkflow.dispatch('LOGIN', 'user@example.com');
			expect(authWorkflow.current.step).toBe('unlogged');
		});

		it('two dispatches from the same workflow are independent', () => {
			const r1 = authWorkflow.dispatch('LOGIN', 'a@example.com');
			const r2 = authWorkflow.dispatch('LOGIN', 'b@example.com');
			expect(r1.success && r2.success).toBe(true);
			if (r1.success && r2.success) {
				expect(r1.data.current.state).toEqual({ email: 'a@example.com' });
				expect(r2.data.current.state).toEqual({ email: 'b@example.com' });
			}
		});
	});
});

describe('counterWorkflow', () => {
	describe('initial state', () => {
		it('starts at the default step', () => {
			expect(counterWorkflow.current.step).toBe('default');
		});

		it('starts with state 0', () => {
			expect(counterWorkflow.current.state).toBe(0);
		});
	});

	describe('INC', () => {
		it('increments the counter by 1', () => {
			const result = counterWorkflow.dispatch('INC', undefined);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.current.state).toBe(1);
		});

		it('can be chained multiple times', () => {
			const r1 = counterWorkflow.dispatch('INC', undefined);
			if (!r1.success) return;
			const r2 = r1.data.dispatch('INC', undefined);
			if (!r2.success) return;
			const r3 = r2.data.dispatch('INC', undefined);
			expect(r3.success).toBe(true);
			if (r3.success) expect(r3.data.current.state).toBe(3);
		});
	});

	describe('DEC', () => {
		it('decrements the counter by 1', () => {
			const result = counterWorkflow.dispatch('DEC', undefined);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.current.state).toBe(-1);
		});
	});

	describe('INC + DEC', () => {
		it('INC then DEC returns to 0', () => {
			const incResult = counterWorkflow.dispatch('INC', undefined);
			if (!incResult.success) return;

			const decResult = incResult.data.dispatch('DEC', undefined);
			expect(decResult.success).toBe(true);
			if (decResult.success) expect(decResult.data.current.state).toBe(0);
		});
	});

	describe('immutability', () => {
		it('dispatching does not mutate the original workflow', () => {
			counterWorkflow.dispatch('INC', undefined);
			expect(counterWorkflow.current.state).toBe(0);
		});
	});
});
