import { cn } from "@repo/shared/lib/utils";
import { LoaderCircle } from "lucide-solid";
import type { ComponentProps, JSX } from "solid-js";

export function Spinner(props: ComponentProps<"svg"> & {
	show?: boolean;
	wait?: `delay-${number}`;
}) {
	return (
		<LoaderCircle
		{...props}
			role="status"
			aria-label="Loading"
			class={cn(
				"size-4 animate-spin",
				(props.show ?? true)
					? `opacity-100 duration-500 ${props.wait ?? "delay-300"}`
					: "duration-500 opacity-0 delay-0",
				props.class,
			)}
			
		/>
	);
}

