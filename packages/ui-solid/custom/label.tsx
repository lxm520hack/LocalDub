import { cn } from "@repo/shared/lib/utils";
import {
	type ComponentProps,
	createSignal,
	onMount,
	splitProps,
} from "solid-js";

export function Label(props: ComponentProps<"label">) {
	return (
		<label
			data-slot="label"
			{...props}
			class={cn(
				"flex items-center pb-2 gap-2  leading-none text-sm font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				props.class,
			)}
		/>
	);
}

export function Description({
	...props
}: ComponentProps<"p"> & {
	size?: "sm" | "md" | "lg";
	maxLine?: number;
}) {
	const [p, others] = splitProps(props, [
		"class",
		"size",
		"maxLine",
		"children",
	]);
	const [isClamped, setIsClamped] = createSignal(false);
	let textRef: HTMLParagraphElement | undefined;
	const [isExpanded, setIsExpanded] = createSignal(false);

	onMount(() => {
		// 此时 ref 已经同步绑定，且 DOM 已挂载
		if (textRef && textRef.scrollHeight > textRef.clientHeight) {
			setIsClamped(true);
		}
	});

	// 纯数字（1234567890...），在浏览器眼中这被视为一个超长的单字。预设情况下，浏览器不会在单字中间強制换行，除非它遇到了空格或连字符
	// break-all：在任意字元间换行（最适合这种纯数字/无空格场景字串）
	// break-words：在单字太长時強制断行
	return (
		<div>
			<p
				{...others}
				ref={textRef}
				class={cn(
					"text-sm  whitespace-pre-wrap wrap-break-word text-secondary-foreground",
					{
						"text-base leading-[1.15] text-foreground":
							(p.size || "md") === "md",
					},
					!isExpanded && `line-clamp-${p.maxLine}`,
					p.class,
				)}
				children={p.children}
			/>
			{(isClamped() || isExpanded()) && (
				<button
					onClick={() => setIsExpanded(!isExpanded())}
					// variant="link"
					// size="sm"
					class="text-xs p-0 h-auto text-muted-foreground hover:text-foreground font-medium hover:underline "
				>
					{isExpanded() ? "收起" : "展开"}
				</button>
			)}
		</div>
	);
}
