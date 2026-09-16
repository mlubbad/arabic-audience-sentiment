import { cn } from "./cn";

export interface TextareaProps extends React.ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn("ui-textarea", className)}
      aria-invalid={invalid ? "true" : undefined}
      {...props}
    />
  );
}
