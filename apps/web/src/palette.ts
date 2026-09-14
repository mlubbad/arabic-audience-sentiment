/** Colour arithmetic, so the palette is a measurement and not a preference.
 *
 * Implemented here rather than pulled in, for the reason the worker's scorer
 * gives: every number the project reports should be auditable in the place it
 * is reported. Two facts about this interface cannot be checked by looking:
 *
 *   1. whether a label is legible — WCAG contrast against the surface it sits
 *      on, which is a ratio of relative luminances and not an impression;
 *   2. whether "إيجابي" and "سلبي" stay apart for a reader with red-green
 *      colour blindness — which is a distance in a perceptual space, measured
 *      after simulating the eye, and is invisible to the eye doing the check.
 *
 * The second is the one that matters here. The palette this replaced looked
 * fine and measured ΔE 3.9 between the two poles under deuteranopia: the one
 * distinction this product sells, erased for about one man in twelve.
 */

/* Machado, Oliveira & Fernandes (2009), severity 1.0, in linear RGB. */
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;
export type Vision = keyof typeof MACHADO;

const srgb = (hex: string): [number, number, number] => {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
};
const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linear = (hex: string) =>
  srgb(hex).map(toLinear) as [number, number, number];

/** WCAG 2.2 relative luminance, and the ratio built from two of them. */
export function contrast(a: string, b: string): number {
  const l = (hex: string) => {
    const [r, g, bl] = linear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklab([r, g, b]: [number, number, number]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as [number, number, number];
}

function simulate(hex: string, kind: Vision): [number, number, number] {
  const [r, g, b] = linear(hex),
    M = MACHADO[kind];
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return [
    clamp(M[0][0] * r + M[0][1] * g + M[0][2] * b),
    clamp(M[1][0] * r + M[1][1] * g + M[1][2] * b),
    clamp(M[2][0] * r + M[2][1] * g + M[2][2] * b),
  ];
}

/**
 * Perceptual distance in OKLab ×100, optionally through a simulated eye.
 * Omitting `kind` measures normal vision: a pair can be far apart there and
 * on top of each other under deuteranopia, which is exactly the failure this
 * exists to catch, so both are worth asserting.
 */
export function deltaE(a: string, b: string, kind?: Vision): number {
  const x = oklab(kind ? simulate(a, kind) : linear(a));
  const y = oklab(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
