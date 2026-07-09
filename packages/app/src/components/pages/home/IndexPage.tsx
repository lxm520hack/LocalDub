import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { createEffect } from "solid-js";


export function IndexPage() {
	const greetQ = fnrpc.createQuery(() => ['greet', { name: 'World' }])
	createEffect(() => {
		console.log('greetQ.data', greetQ.data)
	})
	return (
		<div class="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
			<span class="text-lg">Dashboard</span>
			<span class="text-xs">开发中...</span>
		</div>
	);
}
