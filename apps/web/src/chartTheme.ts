/** The colours the canvas charts draw with.
 *
 * Chart.js paints into a canvas and cannot read a CSS custom property, so the
 * values have to exist in JavaScript as well as in brand.css. That is two
 * copies of one decision, which is how the donut came to be drawing #ff6c77
 * while the chip beside it wrote #d94550. `chartTheme.test.ts` asserts the two
 * copies are identical, so the duplication is checked rather than trusted.
 */
import type { Label } from "@sentiment/contracts";

/** Keyed by label, so a caller cannot pass the four colours in the wrong order. */
export const SENTIMENT: Record<Label, string> = {
  positive: "#0d7a68",
  negative: "#c62839",
  neutral: "#6b6785",
  mixed: "#a25000",
};

/** A class the active analysis cannot express. Absent, not zero. */
export const UNMEASURABLE = "#d1cde3";

/**
 * The timing panels chart one quantity — comments — cut three ways, so they
 * take one colour. They used to take three (two indigos and a salmon), and the
 * salmon was the negative-sentiment hue: a reader who had just learned that
 * rose means "negative" met rose bars that meant "Tuesday".
 */
export const VOLUME = "#4b34c9";
export const VOLUME_FILL = "rgba(75, 52, 201, 0.12)";

export const AXIS_TEXT = "#56527a";
export const GRID_LINE = "#e6e3f0";
