/**
 * Helpers over the strings: dates, video names, purged text, sentiment labels.
 *
 * The code tables that used to live here — sentiment labels, budget states,
 * review states, sync states and collector failures — are in `strings/ar.ts`
 * and `strings/en.ts` now, typed so the two carry the same codes. What stays
 * is the handful of functions that combine a string with a value.
 */
import { stringsFor, type Strings } from "./strings";
import type { Locale } from "./locale";

/** The Arabic sentiment words, for the one surface that is Arabic only: the
 *  landing page. Everything inside the shell reads `S.labels`. */
export const labels = stringsFor("ar").labels;

export const locale = {
  language: "ar",
  direction: "rtl",
  timezone: "Asia/Istanbul",
} as const;

/** `Intl` formats in the interface language; the timezone is the product's. */
export function displayDate(date: string | null, lang: Locale) {
  return date
    ? new Intl.DateTimeFormat(lang, {
        timeZone: locale.timezone,
        dateStyle: "medium",
      }).format(new Date(date))
    : stringsFor(lang).unknownDate;
}

/**
 * The video's real title where the row carried one.
 *
 * Every fixture now carries an authored title of its own (the demo and the
 * e2e kernel alike), so there is nothing left to synthesise here — the id is
 * shown when no title came through, since a wrong name is worse than an
 * honest identifier.
 */
export function videoLabel(id: string, title: string | null | undefined) {
  return title || id;
}

/**
 * What to show where a comment's text used to be.
 *
 * Absent is not empty. The comment existed, was analysed, and still counts in
 * every figure on the page — only its text is gone, removed under the retention
 * rule the platform's terms require. Rendering a blank would read as a comment
 * nobody wrote.
 */
export function commentText(
  c: { text_raw: string | null; content_purged_at: string | null },
  S: Strings,
): string {
  if (c.text_raw !== null) return c.text_raw;
  return c.content_purged_at ? S.purgedText : "";
}

/** Format duration into natural Arabic or English terms. */
export function formatDuration(seconds: number, lang: Locale): string {
  const s = Math.max(1, Math.round(seconds));
  if (lang === "ar") {
    if (s < 60) {
      if (s === 1) return "ثانية واحدة";
      if (s === 2) return "ثانيتان";
      if (s >= 3 && s <= 10) return `${s} ثوانٍ`;
      return `${s} ثانية`;
    }
    const mins = Math.floor(s / 60);
    const remSec = s % 60;
    let minStr = "";
    if (mins === 1) minStr = "دقيقة واحدة";
    else if (mins === 2) minStr = "دقيقتان";
    else if (mins >= 3 && mins <= 10) minStr = `${mins} دقائق`;
    else minStr = `${mins} دقيقة`;

    if (remSec === 0) return minStr;
    let secStr = "";
    if (remSec === 1) secStr = "ثانية واحدة";
    else if (remSec === 2) secStr = "ثانيتان";
    else if (remSec >= 3 && remSec <= 10) secStr = `${remSec} ثوانٍ`;
    else secStr = `${remSec} ثانية`;

    return `${minStr} و${secStr}`;
  }

  // English
  if (s < 60) {
    return `${s}s`;
  }
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
}

/** Calculate elapsed time since a given date and format it. */
export function formatElapsed(
  since: string | Date | number,
  lang: Locale,
): string {
  const time = typeof since === "number" ? since : new Date(since).getTime();
  const elapsedSec = Math.max(0, (Date.now() - time) / 1000);
  return formatDuration(elapsedSec, lang);
}
