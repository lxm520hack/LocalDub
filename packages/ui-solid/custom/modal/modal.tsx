import { ClientOnly, useRouter } from '@tanstack/solid-router';
import type { VariantProps } from 'class-variance-authority';
import { ArrowLeft, ArrowLeftIcon } from 'lucide-solid';
import { createSignal, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Button } from '../../base/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '../../base/dialog';
import type { dialogContentVariants } from '../../base/dialog';
import { cn } from '@repo/shared/lib/utils';

export type ModalProps = {
	children?: JSX.Element | (() => JSX.Element);
	title?: JSX.Element;
	description?: JSX.Element;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	closeOnOverlayClick?: boolean; // 是否 使通过点击遮罩层 关闭模态框 失效
	showCloseButton?: boolean;
	pending?: boolean;
	class?: string;
	titleClass?: string;
	descriptionClass?: string;
	Trigger?: JSX.Element;
} & VariantProps<typeof dialogContentVariants>;
export function Modal(props : ModalProps) {
	return (
		<Dialog
			open={props.open}
			defaultOpen={props.defaultOpen??false}
			onOpenChange={(open) => {
				if ( props.pending) {
					return;
				}
				props.onOpenChange?.(open);
			}}
			// modal={false}
			// disablePointerDismissal={closeOnOverlayClick}
		>
			{props.Trigger && <DialogTrigger children={props.Trigger} />}
			<DialogContent
				class={props.class??'px-4 pb-4'}
				showCloseButton={props.showCloseButton ?? true}
				size={props.size ?? 'md'}
				onInteractOutside={(e) => {
					if (!(props.closeOnOverlayClick ?? true) ) {
						e.preventDefault();
					}
				}}
				onPointerDownOutside={(e) => {
					const target = e.target as HTMLElement;
					console.log(target);
					if (
						target.closest('[data-sonner-toast]') ||
						target.closest('[data-testid=tanstack_devtools]')
					) {
						e.preventDefault();
					}
				}}
				pending={props.pending ?? false}
			>
				{props.title && (
					<DialogHeader class="h-fit pb-2">
						<DialogTitle
							class={cn('text-xl flex pt-3 justify-center', props.titleClass)}
						>
							{props.title}
						</DialogTitle>
						{props.description && (
							<DialogDescription class={props.descriptionClass}>
								{props.description}
							</DialogDescription>
						)}
					</DialogHeader>
				)}

				{/* <div className="py-2">{children}</div> */}
				{/* 'px-6 py-4 my-2' */}
				{/* <section
            className={cn('max-h-full max-w-full', contentClassName)}
          >
          </section> */}
{typeof props.children === 'function' 
    ? <Dynamic component={props.children} /> 
    : props.children}
				{/* {props.children} */}
			</DialogContent>
		</Dialog>
	);
}
interface ModalOnRouteProps extends ModalProps {
	showBackButton?: boolean; // 控制 是否显示返回按钮
}
export function ModalOnRoute(props: ModalOnRouteProps) {
	console.log('ModalOnRoute props', props);
	const router = useRouter();
	if (!props.onOpenChange) {
		props.onOpenChange = (open) => router.history.back();
	}
	return (
		<ClientOnly>
		<Modal
			{...props}
			defaultOpen={props.defaultOpen ?? true}
			onOpenChange={(open) => {
				console.log('onOpenChange', open);
				props.onOpenChange?.(open);
			}}
			closeOnOverlayClick={props.closeOnOverlayClick ?? false}
			
		>
			{typeof props.children === 'function' 
    ? <Dynamic component={props.children} /> 
    : props.children}
			{(props.showBackButton ?? false) ||
				(props.size === 'full' && (
					<Button
						variant="ghost"
						size="icon-sm"
						class="absolute top-1 left-1 p-0 rounded-full"
						onClick={() => router.history.back()}
					>
						<ArrowLeftIcon />
					</Button>
				))}
		</Modal>
				</ClientOnly>
	);
}
interface ModalWithCloseProps extends Omit<ModalProps, 'children'> {
	children?: JSX.Element | ((close: () => void) => JSX.Element);
}
export function ModalWithClose({  ...props }: ModalWithCloseProps) {
	const [, rest] = splitProps(props, ['children']);
	const [open, setOpen] = createSignal(props.defaultOpen);
	return (
		<Modal {...rest} open={open()} onOpenChange={setOpen}>
			{
				typeof props.children === 'function'
					? props.children(() => {
							console.log('close');
							setOpen(false);
						}) // 如果是函数，执行并传入参数
					: props.children // 如果是普通节点，直接渲染
			}
		</Modal>
	);
}
