import { fnrpc } from "#/integrations/fnrpc/client.ts";


export function IndexPage() {
	fnrpc.createQuery(() => ['greet', { name: 'World' }])
	return (
		<div class="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
			<span class="text-lg">Dashboard</span>
			<span class="text-xs">开发中...</span>
		</div>
	);
}
