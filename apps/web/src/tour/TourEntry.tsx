/**
 * The rail's way back into the tour: «الجولة التعريفية», a ghost button in
 * `.app-rail-foot` above the session control. It starts the tour whatever
 * the browser remembers, and tells the shell so it can close the phone
 * sheet the button was pressed in.
 */
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { useTourControls } from "./TourProvider";

export function TourEntry({ onActivate }: { onActivate?: () => void }) {
  const S = useStrings();
  const { start } = useTourControls();
  return (
    <Button
      variant="ghost"
      data-testid="tour-replay"
      onClick={() => {
        start();
        onActivate?.();
      }}
    >
      {S.tourReplay}
    </Button>
  );
}
