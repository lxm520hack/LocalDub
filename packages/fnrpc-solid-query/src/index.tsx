import type { Client, Procedures } from "@fnrpc/client";
import * as solid from "solid-js";
import * as queryCore from "@fnrpc/query-core";
import * as tanstack from "@tanstack/solid-query";

export * from "@fnrpc/query-core";

const _store: { client: null | Client<any>; queryClient: null | tanstack.QueryClient } = {
	client: null,
	queryClient: null,
};

export function createSolidQueryHooks<P extends Procedures>() {
	const helpers = queryCore.createHookHelpers({
		useContext: () => _store as any,
	});

	function useUtils() {
		if (!_store.client || !_store.queryClient)
			throw new Error(
				"The fnrpc context has not been set. Ensure the <fnrpc.Provider> component is higher up in your component tree.",
			);
		return queryCore.createUtils(_store.client as Client<P>, _store.queryClient);
	}

	type K = keyof P & string;

	function createQuery<T extends K>(
		keyAndInput: solid.Accessor<queryCore.QueryKeyAndInputOrSkip<P, T>>,
		opts?: solid.Accessor<queryCore.WrapQueryOptions<P, tanstack.CreateQueryOptions<P[T]["output"], unknown, P[T]["output"], queryCore.QueryKeyAndInput<P, T>>>>,
	) {
		return tanstack.createQuery(() =>
			helpers.useQueryArgs(
				keyAndInput() as any,
				{ ...(opts?.() as any), rspc: { client: _store.client } },
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
				{ ...(opts?.() as any), rspc: { client: _store.client } },
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
						_store.client as any,
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
			_store.client = props.client;
			_store.queryClient = props.queryClient;
			return <>{props.children}</>;
		},
		useUtils,
		createQuery,
		createMutation,
		createSubscription,
	};
}
