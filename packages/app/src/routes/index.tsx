import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
	return (
		<div class="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
			<span class="text-lg">Dashboard</span>
			<span class="text-xs">开发中...</span>
		</div>
	);
}
