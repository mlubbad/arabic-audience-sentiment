/**
 * Engagement timing: the weekly trend, the hour-of-day and day-of-week
 * distributions, in Cards on one three-up grid — the weekly line wider than
 * its two neighbours, since a trend needs the width a distribution does not.
 *
 * Moved out of `Dashboard.tsx`'s `#rp-timing` section verbatim — the
 * `hours`/`weekdays`/`weeks` aggregations stay `useMemo`s in `Dashboard.tsx`
 * (they are a pure function of the filtered rows, computed once and passed
 * down) and the chart `data` objects are unchanged.
 */
import { Bar, Line } from "react-chartjs-2";
import { plottable, type Bucketed } from "../analytics";
import { Card } from "../ui/Card";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { VOLUME, VOLUME_FILL } from "../chartTheme";
import { barOptions, lineOptions } from "./chartOptions";
import { ChartEmpty } from "./PageStates";
import { ChartFigures } from "./ChartFigures";
import { n } from "./format";
import "./timing.css";

export function Timing({
  s,
  S,
  hours,
  weekdays,
  weeks,
}: {
  s: Snapshot;
  S: Strings;
  hours: Bucketed;
  weekdays: Bucketed;
  weeks: Bucketed;
}) {
  return (
    <section className="db-section" id="rp-timing">
      <header>
        <h2>{S.timingTitle}</h2>
        <p className="db-lead">{S.timingLead}</p>
      </header>
      <div className="db-grid--charts">
        <Card>
          <h3 className="db-card-title">{S.weeklyTitle}</h3>
          {!plottable(weeks, 3) ? (
            <ChartEmpty testId="weeks-unplottable">
              <strong>{S.weeklyTooFewStrong}</strong>
              {S.weeklyTooFewLead}
            </ChartEmpty>
          ) : (
            <div
              className="db-chart db-chart--tall"
              aria-hidden="true"
              data-testid="chart-weekly"
            >
              <Line
                data={{
                  labels: weeks.buckets.map((b) => b.label),
                  datasets: [
                    {
                      data: weeks.buckets.map((b) => b.count),
                      borderColor: VOLUME,
                      backgroundColor: VOLUME_FILL,
                      fill: true,
                      tension: 0.3,
                      pointRadius: 0,
                    },
                  ],
                }}
                options={lineOptions}
              />
            </div>
          )}
          {plottable(weeks, 3) && (
            <ChartFigures
              caption={S.weeklyCaption}
              unit={S.weeklyUnit}
              buckets={weeks.buckets}
            />
          )}
          <p className="db-note">
            {weeks.unplaceable > 0
              ? S.weeklyUnplaceable(n(weeks.unplaceable))
              : S.weeklyAllPlaced}
          </p>
        </Card>
        <Card>
          <h3 className="db-card-title">{S.hourlyTitle}</h3>
          {!plottable(hours) ? (
            <ChartEmpty>
              <strong>{S.distributionTooFewStrong}</strong>
              {S.hourlyTooFewLead}
            </ChartEmpty>
          ) : (
            <div
              className="db-chart"
              aria-hidden="true"
              data-testid="chart-hourly"
            >
              <Bar
                data={{
                  labels: hours.buckets.map((b) => b.label),
                  datasets: [
                    {
                      data: hours.buckets.map((b) => b.count),
                      backgroundColor: VOLUME,
                      borderRadius: 4,
                    },
                  ],
                }}
                options={barOptions}
              />
            </div>
          )}
          {plottable(hours) && (
            <ChartFigures
              caption={S.hourlyCaption}
              unit={S.hourlyUnit}
              buckets={hours.buckets}
            />
          )}
          <p className="db-note" data-testid="hours-excluded">
            {hours.unplaceable > 0
              ? S.hourlyUnplaceable(n(hours.unplaceable))
              : S.hourlyAllPlaced}
          </p>
        </Card>
        <Card>
          <h3 className="db-card-title">{S.weekdayTitle}</h3>
          {!plottable(weekdays) ? (
            <ChartEmpty>
              <strong>{S.distributionTooFewStrong}</strong>
              {S.weekdayTooFewLead}
            </ChartEmpty>
          ) : (
            <div
              className="db-chart"
              aria-hidden="true"
              data-testid="chart-weekday"
            >
              <Bar
                data={{
                  labels: weekdays.buckets.map((b) => b.label),
                  datasets: [
                    {
                      data: weekdays.buckets.map((b) => b.count),
                      backgroundColor: VOLUME,
                      borderRadius: 4,
                    },
                  ],
                }}
                options={barOptions}
              />
            </div>
          )}
          {plottable(weekdays) && (
            <ChartFigures
              caption={S.weekdayCaption}
              unit={S.weekdayUnit}
              buckets={weekdays.buckets}
            />
          )}
          <p className="db-note">{S.weekdayNote}</p>
          <p className="db-note">
            {S.undatedLabel}{" "}
            <span data-testid="unknown-dates">{s.unknown_dates}</span>
          </p>
        </Card>
      </div>
    </section>
  );
}
