import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('fetch handler', () => {
	it('responds with ok (unit style)', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toBe('ok');
	});

	it('responds with ok for non-asset paths (integration style)', async () => {
		// Use a path with no matching static asset so the request falls through
		// to the worker's fetch handler rather than the assets binding.
		const request = new Request('http://example.com/api/ping');
		const response = await SELF.fetch(request);
		expect(await response.text()).toBe('ok');
	});
});
