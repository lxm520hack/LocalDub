import { cn } from "@repo/shared/lib/utils";
import type { ComponentProps } from "solid-js";

function Textarea(props: ComponentProps<"textarea">) {
	return (
		<textarea
			{...props}
			data-slot="textarea"
			class={cn(
				"border-input placeholder:text-muted-foreground  aria-invalid:ring-destructive dark:aria-invalid:ring-destructive aria-invalid:border-destructive dark:bg-input flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none  disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
				"focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-[1.5px]",
				props.class,
			)}
		/>
	);
}

export { Textarea };
