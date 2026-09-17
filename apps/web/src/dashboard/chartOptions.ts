import { AXIS_TEXT, GRID_LINE } from "../chartTheme";

/* One family of charts. Every option the five charts share is written here
   once; a chart passes only what is its own (its data, its labels, a
   tooltip label formatter). Colours come from chartTheme, which a test pins
   to brand.css. */
export const font = () => ({
  family: "Audience Arabic, Readex Pro, system-ui, sans-serif",
  size: 12,
});
export const axes = () => ({
  x: { ticks: { color: AXIS_TEXT, font: font() }, grid: { display: false } },
  y: {
    beginAtZero: true,
    ticks: { color: AXIS_TEXT, precision: 0, font: font() },
    grid: { color: GRID_LINE },
  },
});
// Chart.js draws its tooltip on a <canvas> and cannot read a CSS custom
// property, so this is `--text-1` (`#14113a`) at 92% opacity written by hand.
// `chartOptions.test.ts` parses brand.css and asserts the two stay equal.
export const tooltip = () => ({
  backgroundColor: "rgba(20, 17, 58, 0.92)",
  titleFont: font(),
  bodyFont: font(),
  padding: 10,
  cornerRadius: 8,
});
// The charts were motionless before the move and stay so; the only motion on
// the dashboard is the section reveal.
export const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { display: false }, tooltip: tooltip() },
  scales: axes(),
} as const;
export const lineOptions = {
  ...barOptions,
  animation: false,
  elements: { line: { tension: 0.3 }, point: { radius: 3 } },
} as const;
export const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  cutout: "62%",
  plugins: { legend: { display: false }, tooltip: tooltip() },
} as const;
