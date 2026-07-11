import { Show, type JSX } from "solid-js";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cardVariants } from "../base/card";
import { cva, type VariantProps } from "class-variance-authority";
export interface CardXProps {
  class?: string;
  title?: string;
  description?: string;
  // Content?: JSX.Element;
  Footer?: JSX.Element;
  FooterClass?: string;
} 
export const CardX = (p:CardXProps  & VariantProps<typeof cardVariants>) => {
  return <Card variant={p.variant} size={p.size} class={p.class}>
    <Show when={p.title||p.description}>
      <CardHeader>
        <Show when={p.title}>
          {(title) => <CardTitle>{title()}</CardTitle>}
        </Show>
        <Show when={p.description}>
          {(description) => <CardDescription>{description()}</CardDescription>}
        </Show>
      </CardHeader>
    </Show>
    {/* <Show when={p.Content}>
      {(Content) => <CardContent>
        {Content()}
      </CardContent>}
    </Show> */}
    <Show when={p.Footer}>
      {(Footer) => <CardFooter class={p.FooterClass}>
        {Footer()}
      </CardFooter>}
    </Show>
  </Card>
}
