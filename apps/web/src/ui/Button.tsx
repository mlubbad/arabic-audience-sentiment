import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const button = cva("ui-btn", {
  variants: {
    variant: {
      primary: "ui-btn--primary",
      secondary: "ui-btn--secondary",
      ghost: "ui-btn--ghost",
      danger: "ui-btn--danger",
    },
    size: {
      sm: "ui-btn--sm",
      md: "ui-btn--md",
      lg: "ui-btn--lg",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export interface ButtonProps
  extends React.ComponentPropsWithRef<"button">,
    VariantProps<typeof button> {
  /** Renders the child element with the button's classes and behaviour
   *  instead of a `<button>` — for a `Link` that should look like one. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
