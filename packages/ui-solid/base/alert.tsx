import type { Component, ComponentProps, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
 
import * as AlertPrimitive from "@kobalte/core/alert"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
 
import { cn } from "@repo/shared/lib/utils"
 
const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
				info: 'bg-blue-500/10 border border-blue-500/20 text-blue-500',
				warning:
					'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400',
				destructive:
					'text-destructive bg-destructive/10 [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90',
      }
    },
    defaultVariants: {
      variant: "info"
    }
  }
)
 
export type AlertRootProps<T extends ValidComponent = "div"> = AlertPrimitive.AlertRootProps<T> &
  VariantProps<typeof alertVariants> & { class?: string | undefined }
 
const Alert = <T extends ValidComponent = "div">(props: PolymorphicProps<T, AlertRootProps<T>>) => {

  const [local, others] = splitProps(props as AlertRootProps, ["class", "variant"])
  
  return (
    <AlertPrimitive.Root
      class={cn(alertVariants({ variant: props.variant }), local.class)}
      {...others}
    />
  )
}
 
const AlertTitle: Component<ComponentProps<"h5">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return <h5 class={cn("mb-1 font-medium leading-none tracking-tight", local.class)} {...others} />
}
 
const AlertDescription: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return <div class={cn("text-sm [&_p]:leading-relaxed", local.class)} {...others} />
}
export const AlertAction = (props: ComponentProps<'div'>) => {
  const [local, others] = splitProps(props, ["class"])
	return (
		<div
			data-slot="alert-action"
			class={cn('absolute top-2 right-2', local.class)}
			{...others}
		/>
	);
} 
export { Alert, AlertTitle, AlertDescription }