import { cn } from "./cn";

export interface InputProps extends React.ComponentPropsWithRef<"input"> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn("ui-input", className)}
      aria-invalid={invalid ? "true" : undefined}
      {...props}
    />
  );
}
