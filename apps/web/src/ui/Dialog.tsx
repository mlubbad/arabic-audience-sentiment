import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("ui-dialog-title", className)}
    {...props}
  />
);
export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("ui-dialog-description", className)}
    {...props}
  />
);

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** The built-in corner close button's accessible name. Required, not
   *  defaulted to a hard-coded word, so every call site supplies the
   *  current locale's string rather than this component silently speaking
   *  one language. */
  closeLabel: string;
}

export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        className={cn("ui-dialog-content", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="ui-dialog-close"
          aria-label={closeLabel}
        >
          ✕
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
