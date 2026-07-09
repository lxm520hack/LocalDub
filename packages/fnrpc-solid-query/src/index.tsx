import type { Client, Procedures } from "@fnrpc/client";
import * as solid from "solid-js";
import * as queryCore from "@fnrpc/query-core";
import * as tanstack from "@tanstack/solid-query";

export * from "@fnrpc/query-core";

// const _store: { client: null | Client<any>; queryClient: null | tanstack.QueryClient } = {
// 	client: null,
// 	queryClient: null,
// };

export function createSolidQueryHooks<P extends Procedures>(ctx: queryCore.Context<P>) {
	const helpers = queryCore.createHookHelpers({
		useContext: () => ctx,
	});

	function useUtils() {
		if (!ctx.client || !ctx.queryClient)
			throw new Error(
				"The fnrpc context has not been set. Ensure the <fnrpc.Provider> component is higher up in your component tree.",
			);
		return queryCore.createUtils(ctx.client, ctx.queryClient);
	}

	type K = keyof P & string;

	function createQuery<T extends K>(
		keyAndInput: solid.Accessor<queryCore.QueryKeyAndInputOrSkip<P, T>>,
		opts?: solid.Accessor<queryCore.WrapQueryOptions<P, tanstack.CreateQueryOptions<P[T]["output"], unknown, P[T]["output"], queryCore.QueryKeyAndInput<P, T>>>>,
	) {
		return tanstack.createQuery(() =>
			helpers.useQueryArgs(
				keyAndInput() as any,
				opts?.(),
			) as any,
		);
	}

	function createMutation<T extends K>(
		key: solid.Accessor<T>,
		opts?: solid.Accessor<queryCore.WrapMutationOptions<P, tanstack.CreateMutationOptions<P[T]["output"], unknown, P[T]["input"], unknown>>>,
	) {
		return tanstack.createMutation(() =>
			helpers.useMutationArgs(
				key(),
				opts?.(),
			) as any,
		);
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
						keyAndInput as any,
						() => opts as any,
					ctx.client as any,
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
			ctx.client = props.client;
			ctx.queryClient = props.queryClient;
			 return props.children;
		},
		useUtils,
		createQuery,
		createMutation,
		createSubscription,
	};
}
