import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '@repo/shared/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
export const dialogContentVariants = cva(
	'bg-background data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 fixed z-50 shadow-lg outline-none duration-100 ',
	{
		variants: {
			size: {
				xs: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-xs rounded-lg ',
				sm: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-sm rounded-lg ',
				md: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-md rounded-lg ',
				lg: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-lg rounded-lg ',
				xl: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-xl rounded-lg ',
				'2xl':
					'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-2xl rounded-lg ',
				'4xl': 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full sm:max-w-4xl rounded-md',
				'5xl':
					'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2  lg:rounded-lg h-full w-full lg:h-[calc(100%-5rem)]  lg:w-[calc(100%-5rem)] 2xl:max-w-364',
				full: 'inset-0 w-full h-full',
				auto: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg',
			},
		},
		defaultVariants: {
			size: 'md',
		},
	},
);
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal: Component<DialogPrimitive.DialogPortalProps> = (props) => {
	const [, rest] = splitProps(props, ['children']);
	return (
		<DialogPrimitive.Portal {...rest}>
			<div class="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
				{props.children}
			</div>
		</DialogPrimitive.Portal>
	);
};

type DialogOverlayProps<T extends ValidComponent = 'div'> =
	DialogPrimitive.DialogOverlayProps<T> & { class?: string | undefined };

const DialogOverlay = <T extends ValidComponent = 'div'>(
	props: PolymorphicProps<T, DialogOverlayProps<T>>,
) => {
	const [, rest] = splitProps(props as DialogOverlayProps, ['class']);
	return (
		<DialogPrimitive.Overlay
			class={cn(
				'fixed inset-0 z-50 bg-crust/80 data-expanded:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0',
				props.class,
			)}
			{...rest}
		/>
	);
};

type DialogContentProps<T extends ValidComponent = 'div'> =
	DialogPrimitive.DialogContentProps<T> & VariantProps<typeof dialogContentVariants> & {
		class?: string | undefined;
		children?: JSX.Element;
				showCloseButton?: boolean;
		pending?: boolean;
	};

const DialogContent = <T extends ValidComponent = 'div'>(props: PolymorphicProps<T, DialogContentProps<T>> &
	VariantProps<typeof dialogContentVariants> ) => {
	const [local, rest] = splitProps(props as DialogContentProps, [
		'class',
		'children',
		'size',
		'showCloseButton'
	]);
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				class={cn(
					// 'fixed left-1/2 top-1/2 z-50 grid max-h-screen w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 data-[closed]:slide-out-to-left-1/2 data-[closed]:slide-out-to-top-[48%] data-[expanded]:slide-in-from-left-1/2 data-[expanded]:slide-in-from-top-[48%] sm:rounded-lg',
					dialogContentVariants({ size: local.size, class: local.class }),
					// props.class,
				)}
				{...rest}
			>
				{local.children}
				{local.showCloseButton && (
					<DialogPrimitive.CloseButton class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[expanded]:bg-accent data-[expanded]:text-muted-foreground">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="size-4"
						>
							<path d="M18 6l-12 12" />
							<path d="M6 6l12 12" />
						</svg>
						<span class="sr-only">Close</span>
					</DialogPrimitive.CloseButton>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
};

const DialogHeader: Component<ComponentProps<'div'>> = (props) => {
	const [, rest] = splitProps(props, ['class']);
	return (
		<div
			class={cn(
				'flex flex-col space-y-1.5 text-center sm:text-left',
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogFooter: Component<ComponentProps<'div'>> = (props) => {
	const [, rest] = splitProps(props, ['class']);
	return (
		<div
			class={cn(
				'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
				props.class,
			)}
			{...rest}
		/>
	);
};

type DialogTitleProps<T extends ValidComponent = 'h2'> =
	DialogPrimitive.DialogTitleProps<T> & {
		class?: string | undefined;
	};

const DialogTitle = <T extends ValidComponent = 'h2'>(
	props: PolymorphicProps<T, DialogTitleProps<T>>,
) => {
	const [, rest] = splitProps(props as DialogTitleProps, ['class']);
	return (
		<DialogPrimitive.Title
			class={cn(
				'text-lg font-semibold leading-none tracking-tight',
				props.class,
			)}
			{...rest}
		/>
	);
};

type DialogDescriptionProps<T extends ValidComponent = 'p'> =
	DialogPrimitive.DialogDescriptionProps<T> & {
		class?: string | undefined;
	};

const DialogDescription = <T extends ValidComponent = 'p'>(
	props: PolymorphicProps<T, DialogDescriptionProps<T>>,
) => {
	const [, rest] = splitProps(props as DialogDescriptionProps, ['class']);
	return (
		<DialogPrimitive.Description
			class={cn('text-sm text-muted-foreground', props.class)}
			{...rest}
		/>
	);
};

export {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
