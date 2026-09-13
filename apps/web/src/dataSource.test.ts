import { describe, expect, it } from "vitest";
import { describeSource } from "./dataSource";
import type { SyncState } from "./syncHealth";

const NOW = new Date("2026-09-13T12:00:00Z");
const sync = (over: Partial<SyncState> = {}): SyncState => ({
  worker: { connected: true, last_heartbeat_at: "2026-09-13T11:55:00Z" },
  queued_jobs: 0,
  last_run: {
    started_at: "2026-09-13T09:00:00Z",
    ended_at: "2026-09-13T09:30:00Z",
    status: "succeeded",
    source: "youtube_data_api_public",
    error_code: null,
    coverage: { videos_seen: 5, comments_collected: 4899, complete: true },
  },
  ...over,
});
const live = (over = {}) =>
  describeSource({
    mode: "live",
    workspaceId: "ws-1",
    persisted: true,
    sync: sync(),
    total: 4899,
    now: NOW,
    ...over,
  });
const fixture = (over = {}) =>
  describeSource({
    mode: "sanitized_fixture",
    workspaceId: "fixture",
    persisted: false,
    sync: null,
    total: 6,
    now: NOW,
    ...over,
  });

describe("what the dashboard says it is showing", () => {
  it("groups large counts and keeps one numeral system", () => {
    expect(live().coverage).toContain("4,899");
    expect(live().coverage).not.toMatch(/[٠-٩]/);
  });

  it("never tells a live user their correction stayed in the browser", () => {
    // The defect this replaces: the page said corrections are never sent to a
    // server, as fixed text, at the moment live mode was writing them to one.
    expect(live().persistence).not.toContain("الجلسة");
    expect(live().persistence).toContain("تُحفظ");
    expect(fixture().persistence).toContain("لا تُرسل");
  });

  it("takes the persistence claim from the flag the write path uses", () => {
    // Not from the mode. If the two ever disagree, the sentence follows the
    // one that decides what actually happens.
    expect(live({ persisted: false }).persistence).toBe("التصحيحات لا تُحفظ.");
    expect(fixture({ persisted: true }).persistence).toBe("التصحيحات تُحفظ.");
  });

  it("says whose data it is, rather than leaving it implied", () => {
    expect(live().scope).toContain("ws-1");
    expect(fixture().scope).toContain("تجريبية");
    expect(fixture().badge).toBe("بيانات اصطناعية");
    expect(live().badge).toBe("بيانات مباشرة");
  });

  it("does not claim a complete sweep when the source was not read to its end", () => {
    // "Complete" means the source stopped returning rows, never that every
    // comment that exists was retrieved — and a partial sweep must say so,
    // because a number presented as total is the one people act on.
    const partial = live({
      sync: sync({
        last_run: {
          ...sync().last_run!,
          coverage: {
            videos_seen: 5,
            comments_collected: 1200,
            complete: false,
          },
        },
      }),
    });
    expect(partial.coverage).toContain("جزئية");
    expect(live().coverage).toContain("حتى نهايته");
  });

  it("says there was no collection rather than reporting zero coverage", () => {
    // Zero collected reads as "this channel has no comments". Never run reads
    // as "we have not looked yet". Those are different answers.
    const fresh = live({ sync: sync({ last_run: null }) });
    expect(fresh.coverage).toContain("لم تُسجَّل");
    expect(fresh.coverage).not.toMatch(/\b0\b/);
  });

  it("reports how old the collection is, in live mode only", () => {
    // Latin digits, matching the rest of the interface. Arabic-Indic would
    // depend on the ICU data present at runtime and differ between machines.
    expect(live().freshness).toContain("3");
    // The question does not apply to authored data, so it is not answered.
    expect(fixture().freshness).toBeNull();
  });

  it("marks fixture data for the eye, not just for the reader", () => {
    expect(fixture().tone).toBe("warning");
    expect(live().tone).toBe("neutral");
  });
});
