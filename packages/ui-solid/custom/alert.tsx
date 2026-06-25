import { CheckCircle2, CircleX, Info, TriangleAlert } from 'lucide-solid';
import { Alert, AlertAction, AlertDescription, AlertRootProps, AlertTitle } from '../base/alert';
import { ComponentProps, splitProps, type JSX } from 'solid-js';

// 图标映射表
const variantIcons = {
	info: Info,
	warning: TriangleAlert,
	success: CheckCircle2,
	destructive: CircleX, // CircleX, AlertCircleIcon
} as const;

export function UxAlert(props: Omit<AlertRootProps, 'title'> & {
	title?: JSX.Element;
	description?: JSX.Element;
	icon?: JSX.Element;
	children?: JSX.Element;
}) {
	  const [p, others] = splitProps(props, ["class", "variant", 'icon', 'title', 'description', 'children'])
	const Icon = variantIcons[p.variant || 'info'] ?? Info;
	return (
		<Alert class={p.class} variant={p.variant} {...others} >
			
			{p.icon ? p.icon : <Icon />}

			{p.title && <AlertTitle>{p.title}</AlertTitle>}
			<AlertDescription>{p.description}</AlertDescription>
			<AlertAction>{p.children}</AlertAction>
			{/* 自动换行 */}
			{/* line-clamp-1 */}
			{/* <div class="col-start-2  min-h-4 font-medium tracking-tight">
        <p class="wrap-break-word break-keep relative top-[0.7px]">
          {children}
        </p>
      </div> */}
		</Alert>
	);
}
