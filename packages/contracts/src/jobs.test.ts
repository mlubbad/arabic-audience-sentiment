import { describe, expect, it } from "vitest";
import { BatchPayloadSchema, CommitBatchSchema, usageEventKey } from "./index";

const comment = (id: string, over = {}) => ({
  external_comment_id: id,
  external_parent_id: null,
  is_reply: false,
  parent_source: "api" as const,
  author_channel_id: "UCauthor",
  author_name: "مؤلف",
  text_raw: "نص",
  text_plain: "نص",
  content_hash: `hash-${id}`,
  published_time_raw: "2026-09-01T09:00:00Z",
  published_at: "2026-09-01T09:00:00Z",
  timestamp_precision: "second" as const,
  likes_raw: "3",
  likes_value: 3,
  source: "youtube_data_api_public",
  field_provenance: {},
  ...over,
});
const prediction = (id: string, over = {}) => ({
  external_comment_id: id,
  content_hash: `hash-${id}`,
  analysis_key: "model@rev+prep",
  status: "succeeded" as const,
  label: "negative" as const,
  class_scores: { negative: 0.9, positive: 0.1 },
  model_id: "m",
  revision: "abc123",
  preprocessing_version: "v1",
  parameters: { max_length: 256 },
  ...over,
});
const payload = (over = {}) => ({
  external_video_id: "abcdefghijk",
  video_title: "حلقة تجريبية",
  checkpoint: { page: 2 },
  outcome: "partial" as const,
  comments: [comment("c1")],
  predictions: [prediction("c1")],
  ...over,
});
// The envelope as it goes over the wire: payload nested, not spread.
const batch = (over = {}) => ({
  job_id: "20000000-0000-4000-8000-000000000001",
  lease_token: "30000000-0000-4000-8000-000000000001",
  batch_key: "batch-1",
  payload_hash: "a".repeat(64),
  payload: payload(over),
});

describe("worker batch contract", () => {
  it("accepts a well-formed batch", () => {
    expect(CommitBatchSchema.safeParse(batch()).success).toBe(true);
  });

  it("carries no workspace, so a worker cannot address another tenant", () => {
    // The server derives the workspace from the job and the worker credential.
    // A field here would be a privilege-escalation vector, so the strict schema
    // rejects one outright.
    expect(
      CommitBatchSchema.safeParse({
        ...batch(),
        workspace_id: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });

  it("describes the envelope the client actually posts, not a flat batch", () => {
    // This schema used to be one flat object holding both the envelope fields
    // and the payload fields. Nothing ever sent that: the client posts
    // {job_id, lease_token, batch_key, payload_hash, payload}. The seam test
    // reshaped the payload to make it parse, so the mismatch stayed invisible
    // and the handler could not validate against the contract at all.
    const flat = {
      job_id: "20000000-0000-4000-8000-000000000001",
      lease_token: "30000000-0000-4000-8000-000000000001",
      batch_key: "batch-1",
      payload_hash: "a".repeat(64),
      ...payload(),
    };
    expect(CommitBatchSchema.safeParse(flat).success).toBe(false);
    expect(CommitBatchSchema.safeParse(batch()).success).toBe(true);
  });

  it("carries no workspace in the payload either", () => {
    // The envelope test covers the outer object; a forged field one level down
    // would be just as much of an escalation vector.
    expect(
      BatchPayloadSchema.safeParse({
        ...payload(),
        workspace_id: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });

  it("refuses a prediction for a comment the batch never delivered", () => {
    expect(
      BatchPayloadSchema.safeParse(
        payload({ predictions: [prediction("not-in-batch")] }),
      ).success,
    ).toBe(false);
  });

  it("refuses the same comment twice in one batch", () => {
    expect(
      BatchPayloadSchema.safeParse(
        payload({ comments: [comment("c1"), comment("c1")] }),
      ).success,
    ).toBe(false);
  });

  it("keeps status and label coupled, and demands the scores behind a verdict", () => {
    for (const bad of [
      { status: "failed" as const },
      { label: null },
      { class_scores: {} },
    ]) {
      expect(
        BatchPayloadSchema.safeParse(
          payload({ predictions: [prediction("c1", bad)] }),
        ).success,
      ).toBe(false);
    }
    // A skipped row legitimately has no label and no scores.
    expect(
      BatchPayloadSchema.safeParse(
        payload({
          predictions: [
            prediction("c1", {
              status: "skipped",
              label: null,
              class_scores: {},
            }),
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("refuses a top-level comment that names a parent", () => {
    expect(
      BatchPayloadSchema.safeParse(
        payload({
          comments: [
            comment("c1", { is_reply: false, external_parent_id: "p1" }),
          ],
          predictions: [],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires a real digest and bounds the batch", () => {
    expect(
      CommitBatchSchema.safeParse({ ...batch(), payload_hash: "nope" }).success,
    ).toBe(false);
    const many = Array.from({ length: 501 }, (_, i) => comment(`c${i}`));
    expect(
      BatchPayloadSchema.safeParse(payload({ comments: many, predictions: [] }))
        .success,
    ).toBe(false);
  });

  it("bills a unique comment once, whatever happens to its text", () => {
    // Not keyed on the content hash: re-analysing an edited comment is free,
    // so an edit cannot surprise a customer with a charge.
    expect(usageEventKey("youtube", "abc")).toBe("analysis:youtube:abc");
    expect(usageEventKey("youtube", "abc")).toBe(
      usageEventKey("youtube", "abc"),
    );
    expect(usageEventKey("youtube", "abc")).not.toBe(
      usageEventKey("youtube", "abd"),
    );
  });

  it("names the video it covers, and tolerates an unknown title", () => {
    expect(
      BatchPayloadSchema.safeParse(payload({ video_title: null })).success,
    ).toBe(true);
    const withoutVideo: Record<string, unknown> = { ...payload() };
    delete withoutVideo.external_video_id;
    expect(BatchPayloadSchema.safeParse(withoutVideo).success).toBe(false);
  });
});
