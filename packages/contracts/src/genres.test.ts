import { describe, expect, it } from "vitest";
import { GenrePredictionRecordSchema, GenresDueSchema } from "./genres";

describe("video genre contracts", () => {
  it("accepts the switched-off response", () => {
    expect(
      GenresDueSchema.parse({ blocked: "genre_classification_off" }),
    ).toEqual({ blocked: "genre_classification_off" });
  });

  it("requires a genre exactly for successful records", () => {
    const base = {
      external_video_id: "video-1",
      classification_key: "genres:v2+model+g1",
      taxonomy_version: 2,
      confidence: null,
      model_id: "model",
      prompt_version: "g1",
      error_code: "bad",
    };
    expect(() =>
      GenrePredictionRecordSchema.parse({
        ...base,
        status: "succeeded",
        genre_key: null,
      }),
    ).toThrow();
    expect(
      GenrePredictionRecordSchema.parse({
        ...base,
        status: "failed",
        genre_key: null,
      }).status,
    ).toBe("failed");
  });
});
