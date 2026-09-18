/**
 * The tour's one home in the shell: `useTour` over the router and the
 * viewport, the auto-start rule, and the lazily loaded layer. Mounted once
 * in `AppLayout`, so the machine survives the route changes it asks for.
 *
 * Auto-start (design doc, "Behaviour"): on the first render of the shell
 * where a reader is signed in (or in the demo), this browser has no memory
 * of the tour, and the page is one of the three the tour visits — the
 * welcome. `?tour=1` is a support link that starts it regardless of memory,
 * clearing the memory first; the flag is then dropped from the address so a
 * reload does not start it again. Both fire at most once per page load: a
 * reader who dismissed the welcome and walks to another page is not asked
 * on arrival.
 *
 * The layer (`./Tour`, with the welcome dialog and the card) is a separate
 * chunk fetched only once the machine leaves `idle`; a reader who never
 * takes the tour never downloads it.
 */
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { useMediaQuery } from "../ui/useMediaQuery";
import { stepsFor } from "./tourSteps";
import { clearTour, readTour, wantsTour } from "./tourState";
import { keepDemo, useTour, type TourMachine } from "./useTour";

const TourLayer = lazy(() => import("./Tour"));

/** The pages the tour visits: the welcome does not open over `/connected`
 *  or a not-found page, whose readers are mid-task or lost. */
const TOUR_PAGES = ["/dashboard", "/sync", "/account"];

/** Outside a provider (a component test rendering the rail alone) the
 *  controls do nothing, and asking for the machine is a programming error. */
const TourContext = createContext<TourMachine | null>(null);

export function useTourControls(): Pick<TourMachine, "start"> {
  const machine = useContext(TourContext);
  return { start: machine?.start ?? noop };
}

export function useTourMachine(): TourMachine {
  const machine = useContext(TourContext);
  if (!machine) throw new Error("useTourMachine: no TourProvider above");
  return machine;
}

function noop() {}

export function TourProvider({
  session,
  wantsDemo,
  children,
}: {
  session: Session | null;
  wantsDemo: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const phone = useMediaQuery("(max-width: 900px)");
  // `stepsFor(true)` builds a fresh array; the machine watches `steps`, so
  // it must be the same array across renders on the same viewport.
  const steps = useMemo(() => stepsFor(phone), [phone]);
  const machine = useTour({ steps, navigate, pathname, search });
  const { status, start } = machine;

  // Once per page load. The session arrives a tick after mount, so the
  // effect watches it — the ref keeps a later session change (a sign-in on
  // the account page) from asking again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    if (wantsTour(search)) {
      asked.current = true;
      clearTour();
      start();
      navigate({ pathname, search: keepDemo(search) }, { replace: true });
      return;
    }
    if (
      (session || wantsDemo) &&
      readTour() === null &&
      TOUR_PAGES.includes(pathname)
    ) {
      asked.current = true;
      start();
    }
  }, [session, wantsDemo, pathname, search, start, navigate]);

  return (
    <TourContext.Provider value={machine}>
      {children}
      <Suspense fallback={null}>{status !== "idle" && <TourLayer />}</Suspense>
    </TourContext.Provider>
  );
}

/** For a test that renders a consumer with a hand-made machine. */
export const TourContextForTests = TourContext;
