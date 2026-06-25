import type { JSX } from 'solid-js';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '../base/tooltip';

//  ComponentProps<typeof Tooltip> &
// ComponentProps<typeof TooltipContent> &
export function TooltipX({
	children,
	content,
}: {
	content: JSX.Element;
	children: JSX.Element;
}) {
	return (
		<Tooltip>
			<TooltipTrigger>{children}</TooltipTrigger>
			<TooltipContent>{content}</TooltipContent>
		</Tooltip>
	);
}
