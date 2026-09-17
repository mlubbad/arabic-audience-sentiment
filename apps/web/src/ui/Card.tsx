import { Slot } from "@radix-ui/react-slot";
import { cn } from "./cn";

export interface CardProps extends React.ComponentPropsWithRef<"div"> {
  /** Renders the child element with the card's class instead of a `<div>`
   *  — for an `<li>` or an `<article>` that should look like one. */
  asChild?: boolean;
}

export function Card({ className, asChild, ...props }: CardProps) {
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn("ui-card", className)} {...props} />;
}
