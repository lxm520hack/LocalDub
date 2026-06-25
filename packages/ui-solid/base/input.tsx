import { cn } from "@repo/shared/lib/utils";
import type { ComponentProps } from "solid-js";

export const Input = (props: ComponentProps<"input">) => {
	return (
		<input
			{...props}
			data-slot="input"
			class={cn(
				"dark:bg-input border-input  aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/80 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-xs border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium  aria-invalid:ring-[1.5px] md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				"focus-visible:border-ring focus-visible:ring-[1px] focus-visible:ring-ring ",
				props.class,
			)}
		/>
	);
};
