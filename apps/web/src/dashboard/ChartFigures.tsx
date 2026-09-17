/**
 * The numbers a canvas cannot say.
 *
 * Chart.js draws into a <canvas>, which is a picture: the timing panels are
 * marked aria-hidden precisely because a screen reader announcing "canvas"
 * helps nobody. But that left a reader who cannot see the picture with the
 * caption and nothing else — the donut at least spells its four figures out
 * in its legend, while the busiest hour of this channel's day existed only
 * as a shape. This is the same data as text, folded away so it costs a
 * sighted reader one line and gives everyone else the panel.
 */
import { useStrings } from "../strings";
import { n } from "./format";

export function ChartFigures({
  caption,
  unit,
  buckets,
}: {
  caption: string;
  unit: string;
  buckets: readonly { label: string; count: number }[];
}) {
  const S = useStrings();
  return (
    <details className="db-figures">
      <summary>{S.figuresShow}</summary>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">{S.figuresComments}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              <td>{n(b.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
