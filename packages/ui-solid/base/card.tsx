
import { cn } from '@repo/shared/lib/utils';
import { ComponentProps, splitProps } from 'solid-js';
import { cva, type VariantProps } from "class-variance-authority";
export const cardVariants = cva('ring-foreground/10  text-card-foreground  overflow-hidden  text-sm  has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0   *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col', {
	variants: {
		variant: {
			line: "relative hover:bg-accent/10",
			outline: "bg-card ring-1 rounded-xl",
		},
		size: {
			md: "py-4 gap-2",
			sm: "py-3 gap-0 has-data-[slot=card-footer]:pb-0"
		}
	},
	defaultVariants: {
		variant: "line",
		size: "md",
	},
})

type CardProps = ComponentProps<'div'> & VariantProps<typeof cardVariants> 
function Card(props: CardProps) {
	const [local, others] = splitProps(props, ['class', 'size', 'variant', 'children']);
	return (
		<div
			{...others}
			data-slot="card"
			data-size={local.size ?? 'md'}
			class={cn(
				cardVariants({ variant: local.variant, size: local.size }),
				local.class,
			)}
		>
			{/* {(local.variant ?? 'line')==='line' && <div class="bg-primary w-1 absolute inset-0    pointer-events-none" />} */}
			<CardIndicator variant={local.variant} size={local.size} />
			{local.children}
		</div>
	);
}
export const cardIndicatorVariants = cva('bg-primary w-0.75 absolute inset-0    pointer-events-none ', {
	variants: {
		variant: {
			line: "",
			outline: "",
		},
		size: {
			md: "my-4",
			sm: "my-3 "
		}
	},
	defaultVariants: {
		variant: "line",
		size: "md",
	},
})
export const CardIndicator = (p: VariantProps<typeof cardIndicatorVariants>) => {
	return (p.variant ?? 'line')==='line' && <div class={cardIndicatorVariants(p)} />
}

function CardHeader(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-header"
			class={cn(
				'gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3 group/card-header @container/card-header grid auto-rows-min items-start has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardTitle(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-title"
			class={cn(
				'text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardDescription(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-description"
			class={cn('text-muted-foreground text-sm', local.class)}
			{...others}
		/>
	);
}

function CardAction(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-action"
			class={cn(
				'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardContent(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-content"
			class={cn('px-4 group-data-[size=sm]/card:px-3', local.class)}
			{...others}
		/>
	);
}

function CardFooter(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-footer"
			class={cn(
				' rounded-b-xl p-4 group-data-[size=sm]/card:p-3 flex items-center',
				local.class,
			)}
			{...others}
		/>
	);
}

export {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
};
