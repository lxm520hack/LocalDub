import { client, fnrpc } from "#/integrations/fnrpc/client.ts";
import { useQuery } from "@tanstack/solid-query";
import { createEffect } from "solid-js";


export function IndexPage() {
	const greetQ0 =  useQuery(() => ({
		queryKey: ["greet",],
		queryFn: () => client.greet.query({ name: "World" }),
	}))
	const greetQ = fnrpc.createQuery(() => ['greet', { name: 'World' }])
	createEffect(() => {
		console.log('greetQ.data', greetQ0.data, greetQ.data)
	})
	const addQ = fnrpc.createQuery(() => ['add', [1, 2]])
	fnrpc.createQuery(() => ['health_check'])
	return (
		<div class="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
			<span class="text-lg">Dashboard</span>
			<span class="text-xs">开发中...</span>
			<span>{greetQ0.error?.message}</span>
			<span>{greetQ.error?.message}</span>
		</div>
	);
}
