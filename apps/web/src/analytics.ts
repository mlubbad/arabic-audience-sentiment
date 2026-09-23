/**
 * The aggregations the reference dashboard plots, computed from our own rows.
 *
 * Two rules run through all of it.
 *
 * A comment whose timestamp precision is coarser than the question cannot
 * answer it. "Approximate" and "day" precision come from a source that said
 * "منذ ٣ أشهر", and placing that at 00:00 would invent a busiest hour out of
 * a rounding artefact. Those rows are counted as unplaceable and reported
 * beside the chart rather than dropped silently — an hour histogram that
 * quietly omits half the data is worse than one that says what it left out.
 *
 * An author whose name has been purged under retention is not merged with
 * every other purged author into one enormous "commenter". They stop being
 * countable as individuals, and the ranking says so.
 */
import type { LabelledComment } from "@sentiment/contracts";
import type { Label } from "@sentiment/contracts";

/** Precisions fine enough to place a comment at an hour of the day. */
const PLACEABLE = new Set(["second", "minute"]);

export type Bucketed = {
  /** One entry per bucket, in display order. */
  buckets: { key: string; label: string; count: number }[];
  /** Rows the question could not be asked of. Never folded into a bucket. */
  unplaceable: number;
};

function placeable(c: LabelledComment): Date | null {
  if (!c.published_at) return null;
  if (!PLACEABLE.has(c.timestamp_precision)) return null;
  const d = new Date(c.published_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Sunday-first, matching how an Arabic week is read and how the reference
// orders its own weekday chart. The names come from the strings, in the
// interface language; the order is fixed here.
const WEEK = 7;

export function byHour(comments: LabelledComment[]): Bucketed {
  const counts = new Map(HOURS.map((h) => [h, 0]));
  let unplaceable = 0;
  for (const c of comments) {
    const d = placeable(c);
    if (!d) {
      unplaceable++;
      continue;
    }
    counts.set(d.getHours(), (counts.get(d.getHours()) ?? 0) + 1);
  }
  return {
    buckets: HOURS.map((h) => ({
      key: String(h),
      label: `${h}`,
      count: counts.get(h) ?? 0,
    })),
    unplaceable,
  };
}

export function byWeekday(
  comments: LabelledComment[],
  /** Seven names, Sunday first. */
  dayNames: readonly string[],
): Bucketed {
  const counts = new Map(Array.from({ length: WEEK }, (_, i) => [i, 0]));
  let unplaceable = 0;
  for (const c of comments) {
    const d = placeable(c);
    if (!d) {
      unplaceable++;
      continue;
    }
    counts.set(d.getDay(), (counts.get(d.getDay()) ?? 0) + 1);
  }
  return {
    buckets: dayNames.slice(0, WEEK).map((label, i) => ({
      key: String(i),
      label,
      count: counts.get(i) ?? 0,
    })),
    unplaceable,
  };
}

/**
 * Weekly volume. A day-precision timestamp is good enough to place a week, so
 * this accepts more rows than the hour chart does — the two legitimately
 * disagree about how much data they had, and each says so itself.
 */
export function byWeek(comments: LabelledComment[]): Bucketed {
  const counts = new Map<string, number>();
  let unplaceable = 0;
  for (const c of comments) {
    if (!c.published_at || c.timestamp_precision === "unknown") {
      unplaceable++;
      continue;
    }
    const d = new Date(c.published_at);
    if (Number.isNaN(d.getTime())) {
      unplaceable++;
      continue;
    }
    // Monday-start ISO-ish week key, computed in UTC so a viewer's timezone
    // cannot move a comment into a neighbouring week.
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dow = new Date(t).getUTCDay();
    const monday = t - ((dow + 6) % 7) * 86_400_000;
    const key = new Date(monday).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    buckets: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, label: key, count })),
    unplaceable,
  };
}

export type Commenter = {
  key: string;
  name: string;
  avatar_url?: string | null;
  channel_url?: string | null;
  comments: number;
  /** Null when no comment of theirs carried a parsable like count. */
  likes: number | null;
  sentiments: Record<Label, number>;
};

export type Commenters = {
  ranked: Commenter[];
  /** Rows whose author is gone, countable only in aggregate. */
  anonymous: number;
};

/**
 * Who is talking, ranked. `by` chooses the question: volume, or reach.
 *
 * Identity is the author's channel id where there is one. Two people can share
 * a display name, and merging them would invent a commenter who does not
 * exist; falling back to the name is only done when the source gave no id.
 */
export function commenters(
  comments: LabelledComment[],
  by: "comments" | "likes" = "comments",
): Commenters {
  const acc = new Map<string, Commenter>();
  let anonymous = 0;
  for (const c of comments) {
    if (c.author_name === null) {
      anonymous++;
      continue;
    }
    const key = c.author_channel_id ?? `name:${c.author_name}`;
    const found = acc.get(key) ?? {
      key,
      name: c.author_name,
      avatar_url: c.author_profile_image_url ?? null,
      channel_url: c.author_channel_url ?? null,
      comments: 0,
      likes: null,
      sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 } as Record<
        Label,
        number
      >,
    };
    if (!found.avatar_url && c.author_profile_image_url) {
      found.avatar_url = c.author_profile_image_url;
    }
    if (!found.channel_url && c.author_channel_url) {
      found.channel_url = c.author_channel_url;
    }
    found.comments++;
    // Unknown likes stay unknown. Treating null as 0 would rank a commenter
    // whose counts could not be read below one with genuinely zero likes.
    if (c.likes_value !== null)
      found.likes = (found.likes ?? 0) + c.likes_value;
    if (c.label) found.sentiments[c.label]++;
    acc.set(key, found);
  }
  const ranked = [...acc.values()].sort((a, b) =>
    by === "likes"
      ? (b.likes ?? -1) - (a.likes ?? -1) || b.comments - a.comments
      : b.comments - a.comments || (b.likes ?? -1) - (a.likes ?? -1),
  );
  return { ranked, anonymous };
}

/**
 * Whether a set of buckets is worth drawing.
 *
 * A chart with one filled bucket, or none, is not a small chart — it is a
 * claim. An axis with a flat line across it says "we measured this and it did
 * not vary", and an empty grid says "we measured this and found nothing".
 * Neither is true when the answer is that there was not enough to plot, so
 * that case is written out in words instead.
 */
export function plottable(b: Bucketed, minimum = 2): boolean {
  return b.buckets.filter((x) => x.count > 0).length >= minimum;
}

export function hoursToBucketed(hours: number[], unplaceable = 0): Bucketed {
  return {
    buckets: hours.map((count, h) => ({
      key: String(h),
      label: `${h}`,
      count,
    })),
    unplaceable,
  };
}

export function weekdaysToBucketed(
  weekdays: number[],
  dayNames: readonly string[],
  unplaceable = 0,
): Bucketed {
  return {
    buckets: dayNames.slice(0, WEEK).map((label, i) => ({
      key: String(i),
      label,
      count: weekdays[i] ?? 0,
    })),
    unplaceable,
  };
}

export function weeksToBucketed(
  weeks: Array<{
    date?: string;
    week?: string;
    count: number;
  }>,
  unplaceable = 0,
): Bucketed {
  return {
    buckets: weeks.map((item) => {
      const key = item.week ?? item.date ?? "";
      return {
        key,
        label: key,
        count: item.count,
      };
    }),
    unplaceable,
  };
}

export function peopleToCommenters(
  peopleList: Array<{
    name: string;
    channel_id?: string | null;
    avatar_url?: string | null;
    channel_url?: string | null;
    comments_count?: number;
    likes_count?: number;
    key?: string;
    comments?: number;
    likes?: number | null;
    sentiments?: Record<string, number>;
  }>,
  anonymous = 0,
): Commenters {
  return {
    ranked: peopleList.map((p) => ({
      key: p.key ?? p.channel_id ?? p.name,
      name: p.name,
      avatar_url: p.avatar_url ?? null,
      channel_url: p.channel_url ?? null,
      comments: p.comments ?? p.comments_count ?? 0,
      likes: p.likes ?? p.likes_count ?? null,
      sentiments: {
        positive: p.sentiments?.positive ?? 0,
        negative: p.sentiments?.negative ?? 0,
        neutral: p.sentiments?.neutral ?? 0,
        mixed: p.sentiments?.mixed ?? 0,
      },
    })),
    anonymous,
  };
}
