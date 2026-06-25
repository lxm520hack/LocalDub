import { cn } from "@repo/shared/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "solid-js";
import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

function InputGroup(props: ComponentProps<"div">) {
	return (
		<div
			{...props}
			data-slot="input-group"
			role="group"
			class={cn(
				"group/input-group  border-input dark:bg-input shadow-xs relative flex w-full items-center rounded-xs overflow-hidden border outline-none transition-[color,box-shadow]",
				"h-8 has-[>textarea]:h-auto",

				// Variants based on alignment.
				"has-[>[data-align=inline-start]]:[&>input]:pl-2",
				"has-[>[data-align=inline-end]]:[&>input]:pr-2",
				"has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
				"has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

				// Focus state.
				"has-[[data-slot=input-group-control]:focus-visible]:ring-ring has-[[data-slot=input-group-control]:focus-visible]:ring-1",

				// Error state.
				"has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",

				props.class,
			)}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"text-muted-foreground flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
	{
		variants: {
			align: {
				"inline-start":
					"order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]",
				"inline-end":
					"order-last pr-3 has-[>button]:mr-[-0.4rem] has-[>kbd]:mr-[-0.35rem]",
				"block-start":
					"[.border-b]:pb-3 order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5",
				"block-end":
					"[.border-t]:pt-3 order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon(
	props: ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>,
) {
	return (
		<div
			{...props}
			role="group"
			data-slot="input-group-addon"
			data-align={props.align || "inline-start"}
			class={cn(inputGroupAddonVariants({ align: props.align }), props.class)}
			// onClick={e => {
			//   if ((e.target as HTMLElement).closest('button')) {
			//     return
			//   }
			//   e.currentTarget.parentElement?.querySelector('input')?.focus()
			// }}
		/>
	);
}

const inputGroupButtonVariants = cva(
	"flex items-center gap-2 text-sm shadow-none",
	{
		variants: {
			size: {
				xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
				sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
				"icon-xs":
					"size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
				"icon-sm": "size-8 p-0 has-[>svg]:p-0",
			},
		},
		defaultVariants: {
			size: "xs",
		},
	},
);

function InputGroupButton(
	props: Omit<ComponentProps<typeof Button>, "size"> &
		VariantProps<typeof inputGroupButtonVariants>,
) {
	return (
		<Button
			{...props}
			type={props.type || "button"}
			variant={props.variant || "ghost"}
			class={cn(inputGroupButtonVariants({ size: props.size }), props.class)}
		/>
	);
}

function InputGroupText(props: ComponentProps<"span">) {
	return (
		<span
			{...props}
			class={cn(
				"text-muted-foreground flex items-center gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
				props.class,
			)}
		/>
	);
}

function InputGroupInput(props: ComponentProps<"input">) {
	return (
		<Input
			{...props}
			data-slot="input-group-control"
			class={cn(
				"flex-1 rounded-none border-0 aria-invalid:ring-0 shadow-none focus-visible:ring-0 ",
				props.class,
			)}
		/>
	);
}

function InputGroupTextarea(props: ComponentProps<"textarea">) {
	return (
		<Textarea
			{...props}
			data-slot="input-group-control"
			class={cn(
				"flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
				props.class,
			)}
		/>
	);
}

export {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
	InputGroupTextarea,
};
