import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "./cn";

export interface CheckboxProps extends React.ComponentProps<
  typeof CheckboxPrimitive.Root
> {
  label: string;
  /** The box alone, named by `label` but not captioned by it — for a row
   *  whose title is already printed beside the box (the catalogue's
   *  `cat-check-*`), where a second copy of the title would be read twice
   *  and shown twice. */
  hideLabel?: boolean;
}

export function Checkbox({
  label,
  hideLabel,
  className,
  ...props
}: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      className={cn("ui-checkbox", className)}
      aria-label={label}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
        ✓
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (hideLabel) return box;
  return (
    <label className="ui-checkbox-row">
      {box}
      {label}
    </label>
  );
}
