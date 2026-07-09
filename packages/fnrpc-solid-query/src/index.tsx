import type { Client, Procedures } from "@fnrpc/client";
import * as solid from "solid-js";
import * as queryCore from "@fnrpc/query-core";
import * as tanstack from "@tanstack/solid-query";

export * from "@fnrpc/query-core";

export function createSolidQueryHooks<P extends Procedures>() {
	const Context = solid.createContext<queryCore.Context<P> | null>(null);

	const helpers = queryCore.createHookHelpers({
		useContext: () => solid.useContext(Context),
	});

	function useContext() {
		const ctx = solid.useContext(Context);
		if (ctx?.queryClient === undefined)
			throw new Error(
				"The fnrpc context has not been set. Ensure the <Provider> component is higher up in your component tree.",
			);
		return ctx;
	}

	function useUtils() {
		const ctx = useContext();
		return queryCore.createUtils(ctx.client, ctx.queryClient);
	}

	type K = keyof P & string;

	function createQuery<T extends K>(
		keyAndInput: solid.Accessor<queryCore.QueryKeyAndInputOrSkip<P, T>>,
		opts?: solid.Accessor<Record<string, unknown>>,
	) {
		return tanstack.createQuery(() => {
			const args = helpers.useQueryArgs(keyAndInput(), opts?.() as any);
			return args as any;
		});
	}

	function createMutation<T extends K>(
		key: solid.Accessor<T>,
		opts?: solid.Accessor<Record<string, unknown>>,
	) {
		return tanstack.createMutation(() => {
			const args = helpers.useMutationArgs(key(), opts?.() as any);
			return args as any;
		});
	}

	function createSubscription<T extends K>(
		keyAndInput: () => queryCore.QueryKeyAndInputOrSkip<P, T>,
		opts: () => queryCore.SubscriptionOptions<P, T>,
	) {
		solid.createEffect(
			solid.on(
				() => [keyAndInput(), opts()] as const,
				([keyAndInput, opts]) => {
					const unsubscribe = helpers.handleSubscription(
						keyAndInput,
						() => opts,
						helpers.useClient(),
					);
					solid.onCleanup(() => unsubscribe?.());
				},
			),
		);
	}

	return {
		Provider: (props: {
			children?: solid.JSX.Element;
			client: Client<P>;
			queryClient: tanstack.QueryClient;
		}): solid.JSX.Element => {
			return (
				<Context.Provider
					value={{
						client: props.client,
						queryClient: props.queryClient,
					}}
				>
					{props.children}
				</Context.Provider>
			);
		},
		useContext,
		useUtils,
		createQuery,
		createMutation,
		createSubscription,
	};
}
