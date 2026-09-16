import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badge = cva("ui-badge", {
  variants: {
    tone: {
      neutral: "ui-badge--neutral",
      success: "ui-badge--success",
      warning: "ui-badge--warning",
      danger: "ui-badge--danger",
      positive: "ui-badge--positive",
      negative: "ui-badge--negative",
      "sentiment-mixed": "ui-badge--sentiment-mixed",
      "sentiment-neutral": "ui-badge--sentiment-neutral",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps
  extends React.ComponentPropsWithRef<"span">,
    VariantProps<typeof badge> {
  /** True for a badge whose content is a number — applies the numeral face,
   *  not the body face, to that content. */
  numeric?: boolean;
}

export function Badge({ className, tone, numeric, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badge({ tone }), numeric && "ui-num", className)}
      {...props}
    />
  );
}
