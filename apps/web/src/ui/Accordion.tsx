import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { cn } from "./cn";

/** Radix Accordion on the brand tokens. The trigger sits inside a heading —
 *  level 3 by default — so a list of questions keeps its outline for a
 *  screen reader and for the FAQ structured data that mirrors the page. */
export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("ui-accordion-item", className)}
      {...props}
    />
  );
}

export interface AccordionTriggerProps
  extends React.ComponentProps<typeof AccordionPrimitive.Trigger> {
  headingLevel?: 2 | 3 | 4;
}

export function AccordionTrigger({
  className,
  children,
  headingLevel = 3,
  ...props
}: AccordionTriggerProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="ui-accordion-header">
        <AccordionPrimitive.Trigger
          className={cn("ui-accordion-trigger", className)}
          {...props}
        >
          <span className="ui-accordion-trigger-text">{children}</span>
          <span className="ui-accordion-chevron" aria-hidden="true" />
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className={cn("ui-accordion-content", className)}
      {...props}
    >
      <div className="ui-accordion-body">{children}</div>
    </AccordionPrimitive.Content>
  );
}
