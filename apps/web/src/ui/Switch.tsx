import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

export interface SwitchProps extends React.ComponentProps<
  typeof SwitchPrimitive.Root
> {
  label: string;
}

export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label className="ui-switch-row">
      <SwitchPrimitive.Root
        className={cn("ui-switch", className)}
        aria-label={label}
        {...props}
      >
        <SwitchPrimitive.Thumb className="ui-switch-thumb" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}
