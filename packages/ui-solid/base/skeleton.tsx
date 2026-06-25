import { cn } from "@repo/shared/lib/utils";
import type { ComponentProps } from "solid-js";

export function Skeleton(props: ComponentProps<"div">) {
	return (
		<div
			{...props}
			class={cn("animate-pulse rounded-md bg-primary/10", props.class)}
		/>
	);
}
