import { lazy, type Component, type ComponentProps } from "solid-js"
 const Sonner = lazy(() => import('solid-sonner').then(m => ({ default: m.Toaster })));
 
type ToasterProps = ComponentProps<typeof Sonner>
 

export const Toaster: Component<ToasterProps> = (props) => {
  return (
    <Sonner
      class="toaster group"
      toastOptions={{
        classes: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground"
        }
      }}
      {...props}
    />
  )
}
export const toast  = (await import('solid-sonner')).toast