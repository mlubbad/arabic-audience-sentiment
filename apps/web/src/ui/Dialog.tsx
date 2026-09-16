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
  /** `sheet` anchors the panel to the inline-start edge, full height —
   *  a navigation drawer. `center` is the modal every other caller wants. */
  variant?: "center" | "sheet";
}

export function DialogContent({
  className,
  children,
  closeLabel,
  variant = "center",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "ui-dialog-content",
          variant === "sheet" && "ui-dialog-content--sheet",
          className,
        )}
        data-variant={variant}
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
