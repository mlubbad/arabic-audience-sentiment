import { describe, expect, it } from "vitest";
import { suggestionsSchema } from "./competitors";

describe("suggestionsSchema", () => {
  it("accepts a channel whose profile has not been read yet", () => {
    // competitor_suggestions returns these as null until the first discover.
    const channel = {
      id: "c1",
      title: null,
      handle: null,
      subscriber_count: null,
      subscriber_count_hidden: null,
      country: null,
      default_language: null,
      topic_categories: null,
      channel_published_at: null,
      profile_observed_at: null,
      stats_observed_at: null,
    };
    const parsed = suggestionsSchema.parse({
      channel,
      limit: null,
      tracked_count: 0,
      candidates: [],
    });
    expect(parsed.channel.subscriber_count_hidden).toBeNull();
    expect(parsed.limit).toBeNull();
  });
});
