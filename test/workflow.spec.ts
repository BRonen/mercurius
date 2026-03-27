import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { DurableWorkflowInstance } from '../src/index';

const getDO = (name: string) => {
	const id = env.WORKFLOW_DURABLE_OBJECT.idFromName(name);
	return env.WORKFLOW_DURABLE_OBJECT.get(id);
};

const dispatchFails = async (stub: ReturnType<typeof getDO>, action: string, input?: unknown) =>
	runInDurableObject(stub, async (instance: DurableWorkflowInstance) => {
		try {
			instance.workflow.dispatch(action, input);
			return false;
		} catch {
			return true;
		}
	});

describe('WorkflowDO', () => {
	describe('transitions', () => {
		it('LOGIN succeeds from initial state', async () => {
			const stub = getDO('do-login-succeeds');
			await expect(stub.dispatch('LOGIN', 'user@example.com')).resolves.toBeUndefined();
		});

		it('LOGOUT succeeds after LOGIN', async () => {
			const stub = getDO('do-login-then-logout');
			await stub.dispatch('LOGIN', 'user@example.com');
			await expect(stub.dispatch('LOGOUT')).resolves.toBeUndefined();
		});

		it('full cycle: LOGIN → LOGOUT → LOGIN', async () => {
			const stub = getDO('do-full-cycle');
			await stub.dispatch('LOGIN', 'user@example.com');
			await stub.dispatch('LOGOUT');
			await expect(stub.dispatch('LOGIN', 'other@example.com')).resolves.toBeUndefined();
		});

		it('cannot LOGIN twice', async () => {
			const stub = getDO('do-no-double-login');
			await stub.dispatch('LOGIN', 'user@example.com');
			expect(await dispatchFails(stub, 'LOGIN', 'other@example.com')).toBe(true);
		});

		it('cannot LOGOUT twice', async () => {
			const stub = getDO('do-no-double-logout');
			await stub.dispatch('LOGIN', 'user@example.com');
			await stub.dispatch('LOGOUT');
			expect(await dispatchFails(stub, 'LOGOUT')).toBe(true);
		});

		it('LOGOUT fails from initial state', async () => {
			const stub = getDO('do-logout-fails-initial');
			expect(await dispatchFails(stub, 'LOGOUT')).toBe(true);
		});
	});

	describe('state persistence', () => {
		it('step is preserved across stub re-creation — logged', async () => {
			const stub1 = getDO('do-persist-logged');
			await stub1.dispatch('LOGIN', 'user@example.com');

			const stub2 = getDO('do-persist-logged');
			await expect(stub2.dispatch('LOGOUT')).resolves.toBeUndefined();
		});

		it('step is preserved across stub re-creation — unlogged after cycle', async () => {
			const stub1 = getDO('do-persist-unlogged');
			await stub1.dispatch('LOGIN', 'user@example.com');
			await stub1.dispatch('LOGOUT');

			const stub2 = getDO('do-persist-unlogged');
			expect(await dispatchFails(stub2, 'LOGOUT')).toBe(true);
		});

		it('multiple DOs with different names are independent', async () => {
			const a = getDO('do-independent-a');
			const b = getDO('do-independent-b');

			await a.dispatch('LOGIN', 'a@example.com');

			expect(await dispatchFails(b, 'LOGOUT')).toBe(true);
		});
	});
});
