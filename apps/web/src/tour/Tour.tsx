/**
 * The tour's layer — see the design doc's "Structure" (`Tour.tsx`) and
 * "Keyboard". The default export `Tour` is what `TourProvider` (eager, in
 * the shell) `lazy()`-imports once the machine leaves `idle`; the
 * stylesheet is imported here so it rides the same chunk and a reader who
 * never takes the tour never downloads either.
 *
 * Three things, by the machine's state. `welcome`: the dialog
 * (`TourWelcome`). `running` with the step's anchor found: the veil and the
 * card. The veil is one fixed, pointer-transparent layer with a hole cut at
 * the anchor's box — the hole is a positioned box whose enormous box-shadow
 * is the veil, so the anchor itself shows through at full colour and stays
 * clickable while everything around it dims. The card is a non-modal Radix
 * popover anchored to the same element through a virtual ref, so Floating
 * UI does the placing and the collision handling, and the page underneath
 * stays scrollable. While the machine is between anchors (asking for a
 * route, polling for the element) nothing is rendered: a hole has nowhere
 * to be yet.
 *
 * Focus moves into the card on each step, onto «التالي» — the primary
 * door, so Enter continues rather than going back (`tour-back` is first in
 * DOM order, which is where Radix's own mount focus would land). It is
 * not trapped there: `modal={false}` is what keeps the page scrollable, and
 * the spec's "trapped" was ruled a nice-to-have — Tab can leave the card
 * and walk the page, Escape from anywhere skips.
 */
import "./tour.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/Popover";
import { useMediaQuery } from "../ui/useMediaQuery";
import { useTourMachine } from "./TourProvider";
import { TourWelcome } from "./TourWelcome";
import { TOUR_PHONE_QUERY, type TourStep } from "./tourSteps";

/** How far the hole reaches past the anchor's own box, on every side. */
const HOLE_PAD = 8;
/** The card's widest (`tour.css`), and the room a card needs past an
 *  anchor's edge: its tallest body (~260px) plus the gap to the hole and
 *  the viewport's own padding. Used to decide where a card can go before
 *  Radix is asked to place it there. `CARD_ROOM` and `MIN_CUT` are
 *  exported for the placement tests; the rest are this file's own. */
const CARD_WIDTH = 360;
const CARD_GAP = HOLE_PAD + 8;
export const CARD_ROOM = 300;

export type Side = "top" | "bottom" | "left" | "right";
export type Rect = { top: number; left: number; width: number; height: number };
export type Viewport = { width: number; height: number };

/** A step's logical placement as the physical side Radix wants. `start`
 *  and `end` follow the document's direction; on a phone every card sits
 *  below its anchor, the one placement that fits a narrow screen. */
export function sideFor(
  placement: TourStep["placement"],
  dir: string,
  phone: boolean,
): Side {
  if (phone) return "bottom";
  const rtl = dir === "rtl";
  if (placement === "start") return rtl ? "right" : "left";
  if (placement === "end") return rtl ? "left" : "right";
  return placement;
}

/** The side, checked against the room the anchor leaves beside it. A card
 *  the design put `end` of a workspace card finds that card filling the
 *  whole content column: Radix's flip would try the rail's side, which is
 *  narrower than the card, and leave it half past the edge. So a side with
 *  no room is traded for the other, and when neither has it the card goes
 *  below (Radix still flips that to above when the bottom is short). */
export function fitSide(side: Side, rect: Rect, viewport: Viewport): Side {
  if (side !== "left" && side !== "right") return side;
  const need = CARD_WIDTH + 2 * CARD_GAP;
  const room = {
    left: rect.left,
    right: viewport.width - (rect.left + rect.width),
  };
  if (room[side] >= need) return side;
  const other = side === "left" ? "right" : "left";
  if (room[other] >= need) return other;
  return "bottom";
}

/** Where the anchor is scrolled to when it is lit. The middle of the view
 *  (the design's choice) when that leaves a card's room above and below
 *  it; the top when it does not — a workspace card with its setup path,
 *  the catalogue, or any anchor at all on a phone held sideways, whose
 *  390px hold one room and no more — so the room is all on one side,
 *  below. Beside the anchor, the card needs no room above or below. */
export function scrollBlockFor(
  rect: Rect,
  viewport: Viewport,
  side: Side,
): ScrollLogicalPosition {
  if (side === "left" || side === "right") return "center";
  return viewport.height - rect.height >= 2 * CARD_ROOM ? "center" : "start";
}

/** Whether an anchor is tall enough to be cut for its card (below): the
 *  rule `scrollBlockFor` scrolls by — too tall for a centred card's room
 *  on both sides — except that on a screen shorter than two rooms that
 *  would call every anchor tall, so the bar never drops below half a
 *  room: a tabs row or a section nav is short on any screen, and is
 *  scrolled to the top there rather than cut. */
export function isTall(rect: Rect, viewport: Viewport): boolean {
  return rect.height > Math.max(viewport.height - 2 * CARD_ROOM, CARD_ROOM / 2);
}

/** The box the card is placed against: the anchor's, whenever the screen
 *  has a card's room above it or below it (Radix flips between the two).
 *  When it has neither — a tall anchor that fills the screen from near
 *  the top down past where a card would go — the visible top of it, cut
 *  to leave the room at the bottom of the screen, so the card sits over
 *  the anchor's lower part rather than past the viewport's edge; never
 *  thinner than `MIN_CUT`, so a card always has a box to sit under. A
 *  short anchor is never cut, on any screen: with no room either side of
 *  it Radix places the card as best it can. The hole is never cut: it is
 *  the veil's, and it follows the real box. */
export const MIN_CUT = 24;
export function cardAnchorRect(rect: Rect, viewport: Viewport): Rect {
  if (!isTall(rect, viewport)) return rect;
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.top + rect.height, viewport.height);
  const floor = viewport.height - CARD_ROOM;
  if (top >= CARD_ROOM || bottom <= floor) return rect;
  return { ...rect, top, height: Math.max(floor - top, MIN_CUT) };
}

function viewportOf(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The element's box as a plain record. A `DOMRect`'s fields are getters on
 *  its prototype: spread it and nothing comes along. */
function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function toDOMRect(r: Rect): DOMRect {
  return {
    ...r,
    x: r.left,
    y: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    toJSON: () => r,
  } as DOMRect;
}

export default function Tour() {
  const m = useTourMachine();
  const phone = useMediaQuery(TOUR_PHONE_QUERY);
  // The app writes the locale's direction on `<html>` (`locale.ts`); read
  // it at render, so a language switch mid-tour places the next card right.
  const dir =
    typeof document !== "undefined" ? document.documentElement.dir : "";
  const { step, anchorEl } = m;
  // Decided once per anchor, for the veil's scroll and the card's side
  // alike: the room beside an anchor does not change as the page scrolls
  // under the card, and a side that changed mid-step would make it jump.
  const side = useMemo(
    () =>
      step && anchorEl
        ? fitSide(
            sideFor(step.placement, dir, phone),
            rectOf(anchorEl),
            viewportOf(),
          )
        : null,
    [step, anchorEl, dir, phone],
  );
  if (m.status === "welcome")
    return <TourWelcome begin={m.begin} later={m.later} />;
  if (m.status === "running" && step && anchorEl && side)
    return (
      <>
        <TourVeil anchorEl={anchorEl} side={side} />
        <TourCard
          step={step}
          index={m.index}
          total={m.total}
          anchorEl={anchorEl}
          side={side}
          next={m.next}
          back={m.back}
          skip={m.skip}
        />
      </>
    );
  return null;
}

/** The hole's box: the anchor's, inflated by `HOLE_PAD` on every side. */
function boxOf(el: HTMLElement): Rect {
  const r = rectOf(el);
  return {
    top: r.top - HOLE_PAD,
    left: r.left - HOLE_PAD,
    width: r.width + 2 * HOLE_PAD,
    height: r.height + 2 * HOLE_PAD,
  };
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The dimmed page with the anchor cut out. The hole is measured in the
 *  viewport (`position: fixed`), so it is measured again whenever anything
 *  scrolls (captured, so a scrolling panel counts, not only the window),
 *  the window resizes, or the anchor itself changes size — a filter bar
 *  wrapping to a second row. The anchor wears `data-tour-active` while lit
 *  (the outline in `tour.css`, and the browser suite's hook) and is scrolled
 *  into view when it becomes the anchor — and once more if it then grows
 *  into an anchor the first alignment no longer suits: the catalogue is
 *  found while its list is still loading, a short box scrolled to the
 *  middle, and fills the screen a moment later. */
function TourVeil({ anchorEl, side }: { anchorEl: HTMLElement; side: Side }) {
  const [box, setBox] = useState<Rect>(() => boxOf(anchorEl));

  useLayoutEffect(() => {
    // No render when the box has not moved; one measurement per frame
    // however many scroll events a burst brings.
    const take = () => {
      const next = boxOf(anchorEl);
      setBox((prev) => (sameRect(prev, next) ? prev : next));
    };
    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        take();
      });
    };
    // On mount this repeats the state initialiser and changes nothing; it
    // is here for a veil handed a new anchor while mounted.
    take();
    anchorEl.setAttribute("data-tour-active", "");
    let block: ScrollLogicalPosition | null = null;
    const bring = () => {
      const wanted = scrollBlockFor(rectOf(anchorEl), viewportOf(), side);
      if (wanted === block) return;
      block = wanted;
      anchorEl.scrollIntoView({
        block,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };
    bring();
    window.addEventListener("scroll", measure, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            measure();
            bring();
          })
        : null;
    observer?.observe(anchorEl);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      anchorEl.removeAttribute("data-tour-active");
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
    // The side is fixed for the anchor's lifetime (see `Tour`), so listing
    // it changes nothing; it is here for the scroll call above to be honest.
  }, [anchorEl, side]);

  return (
    <div className="tour-veil" aria-hidden="true">
      <div
        className="tour-hole"
        style={{
          top: `${box.top}px`,
          left: `${box.left}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        }}
      />
    </div>
  );
}

function TourCard({
  step,
  index,
  total,
  anchorEl,
  side,
  next,
  back,
  skip,
}: {
  step: TourStep;
  index: number;
  total: number;
  anchorEl: HTMLElement;
  side: Side;
  next: () => void;
  back: () => void;
  skip: () => void;
}) {
  const S = useStrings();
  // Radix's virtual anchor asks for `getBoundingClientRect` and nothing
  // else; this one reads the element's live box on every placement, cut
  // for a tall anchor. `contextElement` is Floating UI's own field: with
  // it, the placement is redone when the element scrolls, resizes or
  // shifts — a catalogue whose list arrives after the card was placed —
  // instead of only when the window does.
  const virtualRef = useMemo(
    () => ({
      current: {
        contextElement: anchorEl,
        getBoundingClientRect: () =>
          toDOMRect(cardAnchorRect(rectOf(anchorEl), viewportOf())),
      },
    }),
    [anchorEl],
  );
  const last = index >= total - 1;
  const nextRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover open modal={false}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-card"
        className="tour-card"
        side={side}
        align="center"
        sideOffset={CARD_GAP}
        collisionPadding={16}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={skip}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nextRef.current?.focus();
        }}
      >
        <Badge data-testid="tour-progress" numeric>
          {S.tourProgress(index + 1, total)}
        </Badge>
        <h2 id="tour-title" className="tour-title">
          {S[step.title]}
        </h2>
        <p id="tour-body" className="tour-body">
          {S[step.body]}
        </p>
        <div className="tour-actions">
          {index > 0 && (
            <Button variant="ghost" data-testid="tour-back" onClick={back}>
              {S.tourBack}
            </Button>
          )}
          <Button ref={nextRef} data-testid="tour-next" onClick={next}>
            {last ? S.tourFinish : S.tourNext}
          </Button>
          <Button variant="link" data-testid="tour-skip" onClick={skip}>
            {S.tourSkip}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
