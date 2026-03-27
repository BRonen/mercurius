import { DurableObject } from "cloudflare:workers";
import { z } from 'zod';

type Either<L, R> = { success: false, error: L } | { success: true, data: R };

export const createInvariants = <
	Invariants extends Record<string, z.ZodType<any>>,
	Specification extends {
		[Invariant in keyof Invariants]: ({
			on: Record<string, (
				action: <Input, Next extends keyof Invariants = Invariant>(
					schema: z.ZodType<Input>,
					handler: (state: z.infer<Invariants[Invariant]>, input: Input) =>
						Either<any, ({ step?: Next, state?: z.infer<Invariants[Next]> })>
				) => ReturnType<typeof handler>
			) => ReturnType<typeof action>>
		})
	}
>(invariants: Invariants) => {
	return {
		invariants,
		defineWorkflow: (specification: Specification) => ({
			invariants,
			specification,
			setup: <Step extends keyof Invariants>(
				current: {
					step: Step,
					state: z.infer<Invariants[Step]>
				}
			) => ({
				invariants,
				specification,
				current,
				// TODO: narrow `action` type to accept only the available actions of the current step
				dispatch: (action: keyof Specification[Step]['on'], input?: unknown) => {
					const result = specification[current.step].on[action](
						(schema, handler) => {
							const inputResult = schema.safeParse(input);

							if (!inputResult.success)
								return { success: false, error: inputResult.error };

							return handler(current.state, inputResult.data);
						}
					);

					if (!result.success)
						return result;

					const state = result.data.state ?? current.state;
					const step = result.data.step ?? current.step;
					const stateResult = invariants[step].safeParse(state);

					if (!stateResult.success)
						return { success: false as const, error: stateResult.error };

					return {
						success: true as const,
						data: createInvariants<Invariants, Specification>(invariants)
							.defineWorkflow(specification)
							.setup({ step, state: stateResult.data })
					};
				}
			}),
		})
	};
};

export const createWorkflow = <
	Invariants extends Record<string, z.ZodType<any>>,
	Specification extends {
		[Invariant in keyof Invariants]: ({
			on: Record<string, (
				action: <Input, Next extends keyof Invariants = Invariant>(
					schema: z.ZodType<Input>,
					handler: (state: z.infer<Invariants[Invariant]>, input: Input) =>
						Either<any, ({ step?: Next, state?: z.infer<Invariants[Next]> })>
				) => ReturnType<typeof handler>
			) => ReturnType<typeof action>>
		})
	}
>(invariants: Invariants) => (spec: Specification) => <InitialStep extends keyof Invariants>(
	initial: { step: InitialStep, state: z.infer<Invariants[InitialStep]> },
	opts?: { stepKey?: string, stateKey?: string }
) => {
	type CreatedInvariants = ReturnType<typeof createInvariants<Invariants, Specification>>;
	type DefinedWorkflow = ReturnType<CreatedInvariants['defineWorkflow']>
	type FullWorkflow = ReturnType<DefinedWorkflow['setup']>

	type Step = keyof Invariants;
	type State = z.infer<Invariants[Step]>;

	return class DurableWorkflow extends DurableObject {
		workflow: FullWorkflow;

		stepKey = "__WORKFLOW_STEP_KEY__";
		stateKey = "__WORKFLOW_STATE_KEY__";

		constructor(state: DurableObjectState, env: Env) {
			super(state, env);

			if (opts?.stepKey) this.stepKey = opts.stepKey;
			if (opts?.stateKey) this.stateKey = opts.stateKey;

			this.workflow = createInvariants<Invariants, Specification>(invariants)
				.defineWorkflow(spec)
				.setup(initial);

			state.blockConcurrencyWhile(async () => {
				const savedStep = await this.ctx.storage.get<Step>(this.stepKey);
				const savedState = await this.ctx.storage.get<State>(this.stateKey);

				if (!savedStep || !savedState) {
					return;
				}

				this.workflow = createInvariants<Invariants, Specification>(invariants)
					.defineWorkflow(spec)
					.setup({ step: savedStep, state: savedState });
			});
		}

		// TODO: narrow `action` type to accept only the available actions of the current step
		async dispatch(action: keyof Specification[Step]['on'], input?: unknown) {
			const result = this.workflow.dispatch(action, input);

			if (!result.success) {
				throw new Error(result.error);
			}

			await this.ctx.storage.put<Step>(this.stepKey, result.data.current.step);
			await this.ctx.storage.put<State>(this.stateKey, result.data.current.state);

			this.workflow = result.data;
		}
	}
};

export type DurableWorkflowClass = ReturnType<ReturnType<ReturnType<typeof createWorkflow>>>;
export type DurableWorkflowInstance = InstanceType<DurableWorkflowClass>;

export const WorkflowDO = createWorkflow({
	unlogged: z.object({ email: z.null() }),
	logged: z.object({ email: z.email() }),
})({
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
})({ step: 'unlogged', state: { email: null } });

export default {
	async fetch(_req: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		return new Response('ok');
	},
};
