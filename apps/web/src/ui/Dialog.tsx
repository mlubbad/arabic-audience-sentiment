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

export interface DialogContentProps extends React.ComponentProps<
  typeof DialogPrimitive.Content
> {
  /** The built-in corner close button's accessible name. Required, not
   *  defaulted to a hard-coded word, so every call site supplies the
   *  current locale's string rather than this component silently speaking
   *  one language. */
  closeLabel: string;
  /** `sheet` anchors the panel to the inline-start edge, full height —
   *  a navigation drawer. `center` is the modal every other caller wants. */
  variant?: "center" | "sheet";
  /** Lands as `data-testid` on the built-in corner close, so a suite can
   *  find it without the caller adding a second close button — which would
   *  share the corner one's accessible name. */
  closeTestId?: string;
}

export function DialogContent({
  className,
  children,
  closeLabel,
  variant = "center",
  closeTestId,
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
          data-testid={closeTestId}
        >
          ✕
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
