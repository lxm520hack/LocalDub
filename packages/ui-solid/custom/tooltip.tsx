import type { JSX } from 'solid-js';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '../base/tooltip';

//  ComponentProps<typeof Tooltip> &
// ComponentProps<typeof TooltipContent> &
export function TooltipX(p: {
	content: JSX.Element;
	children: JSX.Element;
	class?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger class={p.class}>{p.children}</TooltipTrigger>
			<TooltipContent>{p.content}</TooltipContent>
		</Tooltip>
	);
}
