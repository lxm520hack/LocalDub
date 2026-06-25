import { cn } from "@repo/shared/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import {
	type ComponentProps,
	createEffect,
	createMemo,
	type JSX,
	splitProps,
} from "solid-js";
import { Label } from "./label";
import { Separator } from "./separator";

function FieldSet(props: ComponentProps<"fieldset">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<fieldset
			data-slot="field-set"
			class={cn(
				"flex flex-col gap-6",
				"has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldLegend(
	props: ComponentProps<"legend"> & { variant?: "legend" | "label" },
) {
	const [local, others] = splitProps(props, ["class", "variant"]);
	return (
		<legend
			data-slot="field-legend"
			data-variant={local.variant ?? "legend"}
			class={cn(
				"mb-3 font-semibold text-accent-foreground",
				"data-[variant=legend]:text-base",
				"data-[variant=label]:text-sm",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldGroup(props: ComponentProps<"div">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<div
			data-slot="field-group"
			class={cn(
				"group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4",
				local.class,
			)}
			{...others}
		/>
	);
}

export const fieldVariants = cva(
	"group/field data-[invalid=true]:text-destructive flex w-full gap-2",
	{
		variants: {
			orientation: {
				vertical: ["flex-col  [&>.sr-only]:w-auto"],
				horizontal: [
					"flex-row items-center",
					"*:data-[slot=field-label]:flex-auto",
					"has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px has-[>[data-slot=field-content]]:items-start",
				],
				multiRow: [],
				responsive: [
					"@md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto flex-col *:w-full [&>.sr-only]:w-auto",
					"@md/field-group:*:data-[slot=field-label]:flex-auto",
					"@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
				],
			},
		},
		defaultVariants: {
			orientation: "vertical",
		},
	},
);

function Field(
	props: ComponentProps<"div"> & VariantProps<typeof fieldVariants>,
) {
	const [local, others] = splitProps(props, ["class", "orientation"]);
	return (
		<div
			role="group"
			data-slot="field"
			data-orientation={local.orientation ?? "vertical"}
			class={cn(
				fieldVariants({ orientation: local.orientation ?? "vertical" }),
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldContent(props: ComponentProps<"div">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<div
			data-slot="field-content"
			class={cn(
				"group/field-content flex flex-1 flex-col gap-1.5 leading-snug",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldLabel(props: ComponentProps<typeof Label>) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<Label
			data-slot="field-label"
			class={cn(
				"group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50",
				"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border *:data-[slot=field]:p-4",
				"has-data-[state=checked]:bg-primary/25 has-data-[state=checked]:border-primary",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldTitle(props: ComponentProps<"div">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<div
			data-slot="field-label"
			class={cn(
				"flex w-fit items-center gap-2 text-sm font-medium leading-snug group-data-[disabled=true]/field:opacity-50",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldDescription(props: ComponentProps<"p">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<p
			data-slot="field-description"
			class={cn(
				"text-secondary-foreground text-xs font-normal leading-normal group-has-data-[orientation=horizontal]/field:text-balance",
				"nth-last-2:-mt-1 last:mt-0 [[data-variant=legend]+&]:-mt-1.5",
				"[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
				local.class,
			)}
			{...others}
		/>
	);
}

function FieldSeparator(
	props: ComponentProps<"div"> & {
		children?: JSX.Element;
	},
) {
	const [local, others] = splitProps(props, ["class", "children"]);
	return (
		<div
			data-slot="field-separator"
			data-content={!!local.children}
			class={cn(
				"relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
				local.class,
			)}
			{...others}
		>
			<Separator class="absolute inset-0 top-1/2" />
			{local.children && (
				<span
					class="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
					data-slot="field-separator-content"
				>
					{local.children}
				</span>
			)}
		</div>
	);
}

function FieldError(
	props: ComponentProps<"div"> & {
		errors?: Array<{ message?: string } | undefined>;
	},
) {
	const [local, others] = splitProps(props, ["class", "children", "errors"]);
	createEffect(() => {
		console.log("FieldError", props.errors);
	});

	const content = createMemo(() => {
		if (local.children) {
			return local.children;
		}

		if (!local.errors) {
			return null;
		}

		if (local.errors?.length === 1 && local.errors[0]?.message) {
			return local.errors[0].message;
		}

		const allMessages = local.errors.map((err) => err?.message).filter(Boolean);
		const uniqueMessages = Array.from(new Set(allMessages));
		return (
			<ul class="ml-4 flex list-disc flex-col gap-1">
				{uniqueMessages.map((message) => message && <li>{message}</li>)}
			</ul>
		);
	});

	if (!content()) {
		return null;
	}

	return (
		<div
			role="alert"
			data-slot="field-error"
			class={cn("text-destructive text-sm font-normal", local.class)}
			{...others}
		>
			{content()}
		</div>
	);
}

export {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSeparator,
	FieldSet,
	FieldTitle,
};
