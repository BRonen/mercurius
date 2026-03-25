import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { DurableWorkflowInstance } from '../src/index';

const getDO = (name: string) => {
	const id = env.WORKFLOW_DURABLE_OBJECT.idFromName(name);
	return env.WORKFLOW_DURABLE_OBJECT.get(id);
};

describe('WorkflowDO', () => {
	describe('transitions', () => {
		it('LOGIN succeeds from initial state', async () => {
			const stub = getDO('do-login-succeeds');
			await expect(stub.dispatch('LOGIN', { email: 'user@example.com' })).resolves.toBeUndefined();
		});

		it('LOGOUT succeeds after LOGIN', async () => {
			const stub = getDO('do-login-then-logout');
			await stub.dispatch('LOGIN', { email: 'user@example.com' });
			await expect(stub.dispatch('LOGOUT', undefined)).resolves.toBeUndefined();
		});

		it('full cycle: LOGIN → LOGOUT → LOGIN', async () => {
			const stub = getDO('do-full-cycle');
			await stub.dispatch('LOGIN', { email: 'user@example.com' });
			await stub.dispatch('LOGOUT', undefined);
			await expect(stub.dispatch('LOGIN', { email: 'other@example.com' })).resolves.toBeUndefined();
		});

		it('cannot LOGIN twice', async () => {
			const stub = getDO('do-no-double-login');
			await stub.dispatch('LOGIN', { email: 'user@example.com' });
			const threw = await runInDurableObject(stub, async (instance) => {
				const result = instance.machine.dispatch('LOGIN', { email: 'other@example.com' });
				return !result.success;
			});
			expect(threw).toBe(true);
		});

		it('cannot LOGOUT twice', async () => {
			const stub = getDO('do-no-double-logout');
			await stub.dispatch('LOGIN', { email: 'user@example.com' });
			await stub.dispatch('LOGOUT', undefined);
			const threw = await runInDurableObject(stub, async (instance: DurableWorkflowInstance) => {
				const result = instance.machine.dispatch('LOGOUT', undefined);
				return !result.success;
			});
			expect(threw).toBe(true);
		});

		it('LOGOUT fails from initial state', async () => {
			const stub = getDO('do-logout-fails-initial');
			const threw = await runInDurableObject(stub, async (instance: DurableWorkflowInstance) => {
				const result = instance.machine.dispatch('LOGOUT', undefined);
				return !result.success;
			});
			expect(threw).toBe(true);
		});
	});

	describe('state persistence', () => {
		it('step is preserved across stub re-creation — logged', async () => {
			const stub1 = getDO('do-persist-logged');
			await stub1.dispatch('LOGIN', { email: 'user@example.com' });

			// New stub, same DO id — should resume in logged step
			const stub2 = getDO('do-persist-logged');
			await expect(stub2.dispatch('LOGOUT', undefined)).resolves.toBeUndefined();
		});

		it('step is preserved across stub re-creation — unlogged after cycle', async () => {
			const stub1 = getDO('do-persist-unlogged');
			await stub1.dispatch('LOGIN', { email: 'user@example.com' });
			await stub1.dispatch('LOGOUT', undefined);

			const stub2 = getDO('do-persist-unlogged');
			const threw = await runInDurableObject(stub2, async (instance: DurableWorkflowInstance) => {
				const result = instance.machine.dispatch('LOGOUT', undefined);
				return !result.success;
			});
			expect(threw).toBe(true);
		});

		it('multiple DOs with different names are independent', async () => {
			const a = getDO('do-independent-a');
			const b = getDO('do-independent-b');

			await a.dispatch('LOGIN', { email: 'a@example.com' });

			const threw = await runInDurableObject(b, async (instance: DurableWorkflowInstance) => {
				const result = instance.machine.dispatch('LOGOUT', undefined);
				return !result.success;
			});
			expect(threw).toBe(true);
		});
	});
});
