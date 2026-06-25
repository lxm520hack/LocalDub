import { Show, type JSX } from "solid-js";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle, cardVariants } from "../base/card";
import { cva, type VariantProps } from "class-variance-authority";
export interface CardXProps {
  title?: string;
  description?: string;
  Footer?: JSX.Element;
} 
export const CardX = (p:CardXProps  & VariantProps<typeof cardVariants>) => {
  return <Card variant={p.variant} size={p.size}>
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
    <Show when={p.Footer}>
      {(Footer) => <CardFooter>
        {Footer()}
      </CardFooter>}
    </Show>
  </Card>
}
