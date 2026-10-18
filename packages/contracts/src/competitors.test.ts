import { describe, expect, it } from "vitest";
import { FeaturedCandidatesCommitSchema } from "./competitors";

const envelope = {
  job_id: "20000000-0000-4000-8000-000000000001",
  lease_token: "30000000-0000-4000-8000-000000000001",
  batch_key: "featured",
  candidates: [
    {
      candidate_external_id: `UC${"a".repeat(22)}`,
      title: "قناة",
      handle: "@channel",
    },
  ],
};

describe("FeaturedCandidatesCommitSchema", () => {
  it("accepts the strict worker envelope", () => {
    expect(FeaturedCandidatesCommitSchema.parse(envelope)).toEqual(envelope);
  });

  it("refuses malformed ids, oversized batches and unknown fields", () => {
    expect(() =>
      FeaturedCandidatesCommitSchema.parse({
        ...envelope,
        candidates: [
          { ...envelope.candidates[0], candidate_external_id: "bad" },
        ],
      }),
    ).toThrow();
    expect(() =>
      FeaturedCandidatesCommitSchema.parse({
        ...envelope,
        candidates: Array.from({ length: 101 }, () => envelope.candidates[0]),
      }),
    ).toThrow();
    expect(() =>
      FeaturedCandidatesCommitSchema.parse({
        ...envelope,
        workspace_id: "leak",
      }),
    ).toThrow();
  });
});
