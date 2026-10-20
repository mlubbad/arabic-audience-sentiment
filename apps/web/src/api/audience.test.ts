import { describe, expect, it } from "vitest";
import { overlapSchema } from "./audience";

describe("overlapSchema", () => {
  it("parses pending and null ratio fields", () => {
    const parsed = overlapSchema.parse({
      status: "pending",
      computed_at: null,
      universe_size: null,
      thresholds: { min_audience: 100, min_shared: 10 },
      channel: {
        id: "c1",
        title: "Mine",
        platform: "youtube",
        audience_size: null,
      },
      others: [
        {
          channel_id: "c2",
          title: null,
          handle: null,
          platform: "youtube",
          audience_size: null,
          below_threshold: true,
          shared: null,
          share_of_mine: null,
          share_of_mine_ci: null,
          share_of_theirs: null,
          overlap_coefficient: null,
          affinity: null,
        },
      ],
    });
    expect(parsed.status).toBe("pending");
    expect(parsed.others[0]?.share_of_mine).toBeNull();
  });
});
