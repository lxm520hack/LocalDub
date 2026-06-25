import { cn, css } from '@repo/shared/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentProps, splitProps } from 'solid-js';

const badgeVariants = cva(
	'inline-flex items-center justify-center rounded-full  px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default: css(
					'border-transparent bg-button text-secondary-foreground  min-w-5 rounded-full px-2',
				),
				inherit: css(
					'justify-center border-transparent bg-inherit text-inherit hover:bg-transparent min-w-5 rounded-full px-0.5  text-center',
				),
				extra:
					'border-transparent bg-button text-secondary-foreground p-0 min-w-4 absolute top-0 right-0',
				primary:
					'border-transparent bg-primary text-primary-foreground hover:bg-primary/80 min-w-5 rounded-full px-1',
				secondary:
					'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
				destructive:
					'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
				outline: 'text-foreground',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
);

function Badge(
	props: ComponentProps<'span'> & VariantProps<typeof badgeVariants>,
) {
	const [local, others] = splitProps(props, ['class', 'variant']);
	const variantValue = () => local.variant || 'default';
	return (
		<span
			data-slot="badge"
			data-variant={variantValue()}
			class={cn(badgeVariants({ variant: variantValue() }), local.class)}
			{...others}
		/>
	);
}

export { Badge, badgeVariants };
