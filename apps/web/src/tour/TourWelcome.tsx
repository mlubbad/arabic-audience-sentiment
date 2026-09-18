/**
 * The tour's first word — see the design doc's "The steps", row "welcome".
 *
 * A `ui/Dialog` over the page the reader arrived on: what the three pages
 * do, how long the tour takes, that it can be left at any time; then two
 * doors. «ابدأ الجولة» is `begin()`; «ليس الآن», the corner ✕ and Escape
 * are all `later()` — every way of closing without starting is the same
 * decision, remembered as "dismissed" so the welcome never opens on its own
 * again (the rail's replay and `?tour=1` still can).
 */
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";

export function TourWelcome({
  begin,
  later,
}: {
  begin: () => void;
  later: () => void;
}) {
  const S = useStrings();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) later();
      }}
    >
      <DialogContent closeLabel={S.tourLater} data-testid="tour-welcome">
        <DialogTitle>{S.tourWelcomeTitle}</DialogTitle>
        <DialogDescription>{S.tourWelcomeBody}</DialogDescription>
        <div className="tour-welcome-actions">
          <Button data-testid="tour-start" onClick={begin}>
            {S.tourStart}
          </Button>
          <Button variant="ghost" data-testid="tour-later" onClick={later}>
            {S.tourLater}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
