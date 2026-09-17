/**
 * `apps/web/public/fixtures/dashboard.json` (the demo) and
 * `apps/web/public/fixtures/e2e-dashboard.json` (the re-skinned test kernel)
 * are both generated files: `npm run demo:fixture` writes them from
 * `apps/web/scripts/demo-content.mjs`, through `apps/web/scripts/
 * make-demo-fixture.mjs`. Nobody should ever hand-edit the JSON — this file
 * is what would catch it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureSchema } from "@sentiment/contracts";
import { buildDemo, buildE2E } from "../scripts/make-demo-fixture.mjs";
import {
  E2E_STALE_OLD_TEXT,
  STALE_OLD_TEXT,
  TOPICS,
  VIDEOS,
} from "../scripts/demo-content.mjs";

const dashboardJson = readFileSync(
  new URL("../public/fixtures/dashboard.json", import.meta.url),
  "utf8",
);
const e2eJson = readFileSync(
  new URL("../public/fixtures/e2e-dashboard.json", import.meta.url),
  "utf8",
);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("the generator's output is exactly what is committed", () => {
  it("regenerates dashboard.json byte-for-byte", () => {
    expect(`${JSON.stringify(buildDemo(), null, 2)}\n`).toBe(dashboardJson);
  });

  it("regenerates e2e-dashboard.json byte-for-byte", () => {
    expect(`${JSON.stringify(buildE2E(), null, 2)}\n`).toBe(e2eJson);
  });

  it("is deterministic: building twice from the same content produces the same bytes", () => {
    expect(JSON.stringify(buildDemo())).toBe(JSON.stringify(buildDemo()));
    expect(JSON.stringify(buildE2E())).toBe(JSON.stringify(buildE2E()));
  });
});

describe("neither fixture uses the «اصطناع» vocabulary any more", () => {
  it.each([
    ["dashboard.json", () => dashboardJson],
    ["e2e-dashboard.json", () => e2eJson],
  ])("%s", (_name, read) => {
    expect(read()).not.toContain("اصطناع");
  });
});

describe("the demo fixture (dashboard.json)", () => {
  const fixture = FixtureSchema.parse(JSON.parse(dashboardJson));
  const comments = fixture.comments;

  it("has 44 comments", () => {
    expect(comments).toHaveLength(44);
  });

  it("every video_id belongs to the demo channel's six videos", () => {
    const ids = new Set(VIDEOS.map((v) => v.id));
    for (const c of comments) expect(ids.has(c.video_id)).toBe(true);
  });

  it("every content_hash is the sha256 of text_raw", () => {
    for (const c of comments) {
      expect(c.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.content_hash).toBe(sha256(c.text_raw!));
    }
  });

  it("every non-null prediction's content_hash equals the row's hash, except the stale row", () => {
    const staleIds = new Set(
      Object.keys(STALE_OLD_TEXT).map((id) => `demo-${id}`),
    );
    for (const c of comments) {
      if (!c.prediction) continue;
      if (staleIds.has(c.id)) {
        const oldText = STALE_OLD_TEXT[c.id.replace(/^demo-/, "")];
        expect(c.prediction.content_hash).toBe(sha256(oldText));
        expect(c.prediction.content_hash).not.toBe(c.content_hash);
      } else {
        expect(c.prediction.content_hash).toBe(c.content_hash);
      }
      if (c.topic_prediction) {
        expect(c.topic_prediction.content_hash).toBe(c.prediction.content_hash);
      }
    }
  });

  it("every topic prediction names one of the ten taxonomy keys", () => {
    const keys = new Set(TOPICS.map((t) => t.key));
    for (const c of comments) {
      if (c.topic_prediction?.topic_key) {
        expect(keys.has(c.topic_prediction.topic_key)).toBe(true);
      }
    }
  });

  it("has 2 unanalysed comments (the channel's own reply is null for a different reason)", () => {
    const unanalysed = comments.filter(
      (c) => c.prediction === null && !c.by_channel_owner,
    );
    expect(unanalysed).toHaveLength(2);
  });

  it("has exactly 1 channel-owner reply", () => {
    expect(comments.filter((c) => c.by_channel_owner)).toHaveLength(1);
  });

  it("has 2 rows that leave a field unknown: one with no date, one with no likes", () => {
    expect(comments.filter((c) => c.published_at === null)).toHaveLength(1);
    expect(
      comments.filter((c) => c.published_at === null || c.likes_value === null),
    ).toHaveLength(2);
  });

  it("orders comments by published_at ascending, with unknown dates last", () => {
    const dated = comments.filter((c) => c.published_at !== null);
    for (let i = 1; i < dated.length; i++) {
      expect(Date.parse(dated[i].published_at!)).toBeGreaterThanOrEqual(
        Date.parse(dated[i - 1].published_at!),
      );
    }
    expect(comments.at(-1)!.published_at).toBeNull();
  });
});

describe("the e2e fixture (e2e-dashboard.json)", () => {
  const fixture = FixtureSchema.parse(JSON.parse(e2eJson));
  const comments = fixture.comments;
  const byId = new Map(comments.map((c) => [c.id, c]));

  it("keeps the current test kernel's seven ids", () => {
    expect([...byId.keys()].sort()).toEqual(
      [
        "fixture-1",
        "fixture-2",
        "fixture-3",
        "fixture-4",
        "fixture-5",
        "fixture-6",
        "aaaaaaaa-0000-4000-8000-00000000000f",
      ].sort(),
    );
  });

  // The structural values 76+ Playwright tests key their arithmetic off —
  // unchanged from the current committed fixture; only the strings differ.
  const expected: Record<
    string,
    {
      likes_value: number | null;
      published_at: string | null;
      is_reply: boolean;
      by_channel_owner: boolean;
      comment_type: string | null;
    }
  > = {
    "fixture-1": {
      likes_value: 12,
      published_at: "2026-09-01T09:00:00Z",
      is_reply: false,
      by_channel_owner: false,
      comment_type: null,
    },
    "fixture-2": {
      likes_value: 48,
      published_at: "2026-09-02T09:00:00Z",
      is_reply: true,
      by_channel_owner: false,
      comment_type: "اقتراح",
    },
    "fixture-3": {
      likes_value: 3,
      published_at: "2026-09-03T09:00:00Z",
      is_reply: false,
      by_channel_owner: false,
      comment_type: "سؤال",
    },
    "fixture-4": {
      likes_value: 7,
      published_at: "2026-09-04T09:00:00Z",
      is_reply: true,
      by_channel_owner: false,
      comment_type: null,
    },
    "fixture-5": {
      likes_value: null,
      published_at: null,
      is_reply: false,
      by_channel_owner: false,
      comment_type: null,
    },
    "fixture-6": {
      likes_value: 21,
      published_at: "2026-09-06T09:00:00Z",
      is_reply: false,
      by_channel_owner: false,
      comment_type: null,
    },
    "aaaaaaaa-0000-4000-8000-00000000000f": {
      likes_value: 48,
      published_at: "2026-09-02T09:00:00Z",
      is_reply: true,
      by_channel_owner: true,
      comment_type: "اقتراح",
    },
  };

  it.each(Object.entries(expected))(
    "%s keeps its structural fields",
    (id, values) => {
      const row = byId.get(id);
      expect(row).toBeDefined();
      expect(row!.likes_value).toBe(values.likes_value);
      expect(row!.published_at).toBe(values.published_at);
      expect(row!.is_reply).toBe(values.is_reply);
      expect(row!.by_channel_owner).toBe(values.by_channel_owner);
      expect(row!.comment_type).toBe(values.comment_type);
    },
  );

  it("every content_hash is the sha256 of text_raw", () => {
    for (const c of comments) {
      expect(c.content_hash).toBe(sha256(c.text_raw!));
    }
  });

  it("keeps fixture-6 stale: its prediction hash is of the text before the edit, not the current one", () => {
    const row = byId.get("fixture-6")!;
    expect(row.prediction).not.toBeNull();
    expect(row.prediction!.content_hash).toBe(
      sha256(E2E_STALE_OLD_TEXT["fixture-6"]),
    );
    expect(row.prediction!.content_hash).not.toBe(row.content_hash);
    expect(row.topic_prediction!.content_hash).toBe(
      row.prediction!.content_hash,
    );
  });

  it("keeps fixture-3's review current: its content_hash still matches the (new) text", () => {
    const row = byId.get("fixture-3")!;
    expect(row.reviews).toHaveLength(1);
    expect(row.reviews[0].content_hash).toBe(row.content_hash);
  });
});
