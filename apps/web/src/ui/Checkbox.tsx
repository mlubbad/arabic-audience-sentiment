import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "./cn";

export interface CheckboxProps
  extends React.ComponentProps<typeof CheckboxPrimitive.Root> {
  label: string;
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className="ui-checkbox-row">
      <CheckboxPrimitive.Root
        className={cn("ui-checkbox", className)}
        aria-label={label}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
          ✓
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}
