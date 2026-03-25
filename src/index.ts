import { DurableObject } from "cloudflare:workers";
import { z } from 'zod';

// TODO: check the step returned statically preventing invalid transitions between states.
// TODO: add state validator to infer state invariants statically

type Action<State, Step, Schema> = {
	validator: z.ZodType<Schema>;
	handler: (state: State, data: Schema) => { state?: State, step?: NoInfer<Step> };
};

type ActionBuilder<State, Step> = <Schema>(
	validator: z.ZodType<Schema>,
	handler: (state: State, data: Schema) => { state?: State; step?: NoInfer<Step> }
) => ({ validator: typeof validator, handler: typeof handler });

export const createMachine = <
	State,
	Step extends string,
	ActionName extends string,
	Transitions extends Record<Step, Record<ActionName, Action<State, Step, any>>>
>(
	config: {
		initialStep: keyof Transitions,
		state: State,
		transitions: (action: ActionBuilder<State, Step>) => Transitions
	}
) => {
	type TransitionValue = Record<ActionName, Action<State, Step, any>>;
	// type ActionValue = Action<State, Step, any>;

	const transitions = config.transitions((validator, handler) => ({ validator, handler }));
	const currentTransitions: TransitionValue = transitions[config.initialStep];

	const dispatch = (action: ActionName, input?: unknown) => {
		if (!(action in currentTransitions))
			return {
				success: false as const,
				message: 'trying to dispatch an invalid action',
			};

		const { validator, handler } = currentTransitions[action];

		const inputResult = z.safeParse(validator, input);

		if (!inputResult.success)
			return {
				success: false as const,
				message: 'invalid input for action',
			};

		const result = handler(config.state, inputResult.data);

		return {
			success: true as const,
			data: createMachine<State, Step, ActionName, Transitions>({
				initialStep: result.step ?? config.initialStep,
				state: result.state ?? config.state,
				transitions: config.transitions
			}),
		};
	};

	return {
		...config,
		transitions,
		dispatch
	}
};

export const createWorkflow = <
	State,
	Step extends string,
	ActionName extends string,
	Transitions extends Record<Step, Record<string, Action<State, Step, any>>>
>(cfg: Parameters<typeof createMachine<State, Step, ActionName, Transitions>>[0], stepKey?: string, stateKey?: string) =>
	class DurableWorkflow extends DurableObject {
		machine: ReturnType<typeof createMachine<State, Step, ActionName, Transitions>>;
		stepKey = "__WORKFLOW_STEP_KEY__";
		stateKey = "__WORKFLOW_STATE_KEY__";

		constructor(state: DurableObjectState, env: Env) {
			super(state, env);
			this.machine = createMachine(cfg);

			if (stepKey) this.stepKey = stepKey;
			if (stateKey) this.stateKey = stateKey;

			state.blockConcurrencyWhile(async () => {
				const savedStep = await this.ctx.storage.get<Step>(this.stepKey);
				const savedState = await this.ctx.storage.get<State>(this.stateKey);

				if (savedStep && savedState) {
					this.machine = createMachine<State, Step, ActionName, Transitions>({
						initialStep: savedStep,
						state: savedState,
						transitions: cfg.transitions
					});
				}
			});
		}

		async dispatch(action: ActionName, input: unknown) {
			const result = this.machine.dispatch(action, input);

			if (!result.success) {
				throw new Error(result.message);
			}

			await this.ctx.storage.put(this.stepKey, result.data.initialStep);
			await this.ctx.storage.put(this.stateKey, result.data.state);

			this.machine = result.data;
		}
	};

export type DurableWorkflowClass = ReturnType<typeof createWorkflow>;
export type DurableWorkflowInstance = InstanceType<DurableWorkflowClass>;

export const WorkflowDO = createWorkflow({
	initialStep: 'unlogged',
	state: { email: '' },
	transitions: (action) => ({
		unlogged: {
			LOGIN: action(
				z.object({ email: z.email() }),
				(_s, data) => ({ step: 'logged', state: { email: data.email } })
			)
		},
		logged: {
			LOGOUT: action(
				z.void(),
				(_s, _d) => ({ step: 'unlogged', state: { email: '' }})
			)
		}
	})
});

export default {
	async fetch(_req: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		return new Response('ok');
	},
};
