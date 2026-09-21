/**
 * Engagement timing: the weekly trend, the hour-of-day and day-of-week
 * distributions, in Cards on one grid — the weekly line across the full
 * width, the two distributions as halves beneath it, since a 24-bar chart
 * needs more than the third of a row it used to get.
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
import { ChartEmpty } from "../pageStates/PageStates";
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
  const peakHourBucket = [...hours.buckets].sort(
    (a, b) => b.count - a.count,
  )[0];
  const peakDayBucket = [...weekdays.buckets].sort(
    (a, b) => b.count - a.count,
  )[0];
  const maxHour = Math.max(0, ...hours.buckets.map((b) => b.count));
  const maxDay = Math.max(0, ...weekdays.buckets.map((b) => b.count));
  const hasTimingData =
    peakHourBucket &&
    peakHourBucket.count > 0 &&
    peakDayBucket &&
    peakDayBucket.count > 0;

  return (
    <section className="db-section" id="rp-timing">
      <header>
        <h2>{S.secTimingTitle}</h2>
        <p className="db-lead">{S.timingLead}</p>
        {hasTimingData && (
          <div className="db-timing-takeaways" data-testid="timing-takeaways">
            <div className="db-timing-pill">
              <span className="db-timing-pill-badge">{S.timingPeakBadge}</span>
              <span className="db-timing-pill-text">
                {S.timingPeakHeadline(
                  peakDayBucket.label,
                  peakHourBucket.label,
                  n(peakHourBucket.count),
                )}
              </span>
            </div>
            <div className="db-timing-meta-pills">
              <span className="db-timing-subpill">
                {S.timingDayPeak(peakDayBucket.label)}
              </span>
              <span className="db-timing-subpill">
                {S.timingHourPeak(peakHourBucket.label)}
              </span>
            </div>
          </div>
        )}
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
                      backgroundColor: hours.buckets.map((b) =>
                        b.count > 0 && b.count === maxHour
                          ? VOLUME
                          : "rgba(75, 52, 201, 0.35)",
                      ),
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
                      backgroundColor: weekdays.buckets.map((b) =>
                        b.count > 0 && b.count === maxDay
                          ? VOLUME
                          : "rgba(75, 52, 201, 0.35)",
                      ),
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
