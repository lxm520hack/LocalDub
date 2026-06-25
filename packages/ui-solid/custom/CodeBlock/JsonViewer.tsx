import { cn } from "@repo/shared/lib/utils";

interface JsonViewerProps {
	data: unknown;
	title?: string;
	class?: string;
}

export function JsonViewer(p: JsonViewerProps) {
	return (
		<div class={cn("rounded-lg border bg-muted/50", p.class)}>
			{p.title && (
				<div class="border-b px-4 py-2">
					<h3 class="text-sm font-medium text-muted-foreground">{p.title}</h3>
				</div>
			)}
			<pre class="overflow-auto p-4 text-sm">
				<code class="text-foreground">{JSON.stringify(p.data, null, 2)}</code>
			</pre>
		</div>
	);
}
