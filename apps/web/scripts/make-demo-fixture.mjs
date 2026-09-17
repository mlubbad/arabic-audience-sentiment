#!/usr/bin/env node
// Builds the two fixture files a signed-out visitor and the browser suite each
// read, from one authored content module (`demo-content.mjs`). Deterministic:
// no Date.now(), no random ids, stable key order — running this twice with an
// unchanged demo-content.mjs writes byte-identical files.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTHORS,
  CHANNEL,
  COMMENTS,
  E2E_COMMENTS,
  E2E_STALE_OLD_TEXT,
  E2E_VIDEOS,
  REVIEWS,
  STALE_OLD_TEXT,
  TOPICS,
  TOPIC_REVIEWS,
  VIDEOS,
} from "./demo-content.mjs";

const FIXTURES_DIR = fileURLToPath(
  new URL("../public/fixtures/", import.meta.url),
);
const DASHBOARD_PATH = FIXTURES_DIR + "dashboard.json";
const E2E_PATH = FIXTURES_DIR + "e2e-dashboard.json";
const CATALOGUE_PATH = FIXTURES_DIR + "catalogue.json";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const ANALYSIS_KEY = "fixture-v1";
const TOPIC_CLASSIFICATION_KEY = "topics:v1+gemini-3.6-flash+p1";
// Read once by both fixtures — kept byte-identical between them (spec: "Keep
// plan, sync, active_analysis_labels, topics, active_topic_key,
// active_analysis_key, mode byte-identical in both outputs").
const PLAN = {
  plan_key: "pilot-fixture",
  status: "active",
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  budgets: [
    { event_type: "comment_analysis", used: 74, allowance: 100, remaining: 26 },
    {
      event_type: "historical_backfill",
      used: 0,
      allowance: 500,
      remaining: 500,
    },
  ],
};
const SYNC = {
  worker: { connected: false, last_heartbeat_at: null },
  queued_jobs: 0,
  last_run: null,
};
const ACTIVE_ANALYSIS_LABELS = ["positive", "negative", "neutral", "mixed"];

// The `field_provenance.origin` in both fixtures — one honest sentence, no
// longer «اصطناعي».
const PROVENANCE_ORIGIN =
  "authored illustrative demo data; not real commenters";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** `date` plus one calendar day, in the same no-milliseconds ISO shape the
 * fixture already uses everywhere else. */
function plusOneDay(iso) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function classScores(label) {
  return {
    positive: label === "positive" ? 1 : 0,
    negative: label === "negative" ? 1 : 0,
    neutral: label === "neutral" ? 1 : 0,
    mixed: label === "mixed" ? 1 : 0,
  };
}

function buildPrediction(label, contentHash, predictedAt) {
  if (!label) return null;
  return {
    status: "succeeded",
    label,
    content_hash: contentHash,
    analysis_key: ANALYSIS_KEY,
    model_id: "sanitized-fixture",
    revision: ANALYSIS_KEY,
    preprocessing_version: ANALYSIS_KEY,
    predicted_at: predictedAt,
    class_scores: classScores(label),
  };
}

/** Same shape as the sentiment prediction's `predicted_at` (date + 1 day),
 * but its own fallback for an unknown date: `2026-09-01T00:00:00Z`, not the
 * sentiment prediction's `2026-09-14T00:00:00Z` — c13 has no date and its
 * topic review lands 2026-09-10, so the topic prediction must predate that,
 * while the sentiment prediction has no review to precede. */
function topicPredictedAt(date) {
  return date ? plusOneDay(date) : "2026-09-01T00:00:00Z";
}

function buildTopicPrediction(topic, contentHash, predictedAt) {
  if (!topic) return null;
  return {
    status: "succeeded",
    topic_key: topic,
    confidence: 0.86,
    content_hash: contentHash,
    classification_key: TOPIC_CLASSIFICATION_KEY,
    model_id: "gemini-3.6-flash",
    prompt_version: "p1",
    predicted_at: predictedAt,
    error_code: null,
  };
}

function commentTypeFor(topic) {
  if (topic === "question") return "سؤال";
  if (topic === "request") return "اقتراح";
  return null;
}

/** Ascending by `published_at`, unknown dates last, stable otherwise. */
function byPublishedAtAscendingNullsLast(a, b) {
  if (a.published_at === null && b.published_at === null) return 0;
  if (a.published_at === null) return 1;
  if (b.published_at === null) return -1;
  return Date.parse(a.published_at) - Date.parse(b.published_at);
}

/** The demo fixture: `apps/web/public/fixtures/dashboard.json`. */
export function buildDemo() {
  const videoById = new Map(VIDEOS.map((v) => [v.id, v]));
  const reviewById = new Map(REVIEWS.map((r) => [r.id, r]));
  const topicReviewById = new Map(TOPIC_REVIEWS.map((r) => [r.id, r]));

  const comments = COMMENTS.map((c) => {
    const video = videoById.get(c.video);
    const isReply = Boolean(c.reply);
    const isOwner = Boolean(c.owner);
    const rowHash = sha256(c.text);
    const isStale = Object.prototype.hasOwnProperty.call(STALE_OLD_TEXT, c.id);
    const predictionHash = isStale ? sha256(STALE_OLD_TEXT[c.id]) : rowHash;
    const predictedAt = c.date ? plusOneDay(c.date) : "2026-09-14T00:00:00Z";

    const review = reviewById.get(c.id);
    const reviews = review
      ? [
          {
            label: review.label,
            content_hash: rowHash,
            created_at: review.at,
            origin: "human",
            reviewer_id: review.by,
            reason: review.reason,
          },
        ]
      : [];

    const topicReview = topicReviewById.get(c.id);
    const topicReviews = topicReview
      ? [
          {
            topic_key: topicReview.topic,
            content_hash: rowHash,
            created_at: topicReview.at,
            origin: "human",
            reviewer_id: topicReview.by,
            reason: topicReview.reason,
          },
        ]
      : [];

    return {
      id: `demo-${c.id}`,
      workspace_id: WORKSPACE_ID,
      client_id: "demo-client",
      channel_id: "demo-channel",
      video_id: c.video,
      video_kind: video.kind,
      author_channel_id: isOwner ? "demo-channel" : `demo-${c.author}`,
      author_name: isOwner ? CHANNEL.handle : AUTHORS[c.author],
      text_raw: c.text,
      content_hash: rowHash,
      likes_raw: c.likes != null ? String(c.likes) : null,
      likes_value: c.likes != null ? c.likes : null,
      published_at: c.date ?? null,
      published_time_raw: c.date ?? null,
      timestamp_precision: c.date ? "second" : "unknown",
      is_reply: isReply,
      parent_comment_id: c.reply ? `demo-${c.reply}` : null,
      parent_source: c.reply ? "api" : "unknown",
      source: "sanitized_fixture",
      field_provenance: { origin: PROVENANCE_ORIGIN },
      comment_type: commentTypeFor(c.topic),
      prediction: buildPrediction(c.label, predictionHash, predictedAt),
      reviews,
      video_title: video.title,
      by_channel_owner: isOwner,
      topic_prediction: buildTopicPrediction(
        c.topic,
        predictionHash,
        topicPredictedAt(c.date),
      ),
      topic_reviews: topicReviews,
    };
  });

  comments.sort(byPublishedAtAscendingNullsLast);

  return {
    mode: "sanitized_fixture",
    revision: "fixture-dataset-v2",
    active_analysis_key: ANALYSIS_KEY,
    plan: PLAN,
    sync: SYNC,
    comments,
    active_analysis_labels: ACTIVE_ANALYSIS_LABELS,
    topics: TOPICS,
    active_topic_key: TOPIC_CLASSIFICATION_KEY,
  };
}

/**
 * The e2e fixture: the current `dashboard.json` (the seven-row test kernel),
 * re-skinned. `apps/web/public/fixtures/e2e-dashboard.json` must already exist
 * (a one-time `cp` of the current `dashboard.json`, done before this script is
 * ever run) — every structural field comes from it unchanged; only the
 * strings in `E2E_COMMENTS`/`E2E_VIDEOS` and the hashes they change are new.
 * Idempotent: reading the already-transformed file and applying the same pure
 * mapping again yields the same file.
 */
export function buildE2E() {
  const raw = JSON.parse(readFileSync(E2E_PATH, "utf8"));
  const titleById = new Map(E2E_VIDEOS.map((v) => [v.id, v.title]));

  const comments = raw.comments.map((original) => {
    const content = E2E_COMMENTS[original.id];
    if (!content) {
      throw new Error(
        `demo-content.mjs has no E2E_COMMENTS entry for "${original.id}"`,
      );
    }
    const newHash = sha256(content.text);
    // A review formed on the text as it stood before this re-skin keeps
    // meaning "this review no longer matches the current text" only if it
    // already meant that before the re-skin — never sha256("hash-before-the-edit"),
    // and never made to match by accident either. The topic dimension keeps
    // its own review log (see demo-content.mjs), and needs the identical
    // remap: a human topic verdict formed on the pre-re-skin text must still
    // read as current, not fall back to stale merely because the words moved.
    const remapReviewHash = (review) => ({
      ...review,
      content_hash:
        review.content_hash === original.content_hash
          ? newHash
          : review.content_hash,
    });
    const reviews = (original.reviews ?? []).map(remapReviewHash);
    const topicReviews = (original.topic_reviews ?? []).map(remapReviewHash);
    const isStaleRow = Object.prototype.hasOwnProperty.call(
      E2E_STALE_OLD_TEXT,
      original.id,
    );
    const predictionHash = isStaleRow
      ? sha256(E2E_STALE_OLD_TEXT[original.id])
      : newHash;

    return {
      ...original,
      author_name: content.author,
      text_raw: content.text,
      content_hash: newHash,
      video_title: titleById.get(original.video_id) ?? original.video_title,
      field_provenance: { origin: PROVENANCE_ORIGIN },
      prediction: original.prediction && {
        ...original.prediction,
        content_hash: predictionHash,
      },
      reviews,
      topic_prediction: original.topic_prediction && {
        ...original.topic_prediction,
        content_hash: predictionHash,
      },
      topic_reviews: topicReviews,
    };
  });

  return {
    mode: "sanitized_fixture",
    revision: "fixture-dataset-v1",
    active_analysis_key: ANALYSIS_KEY,
    plan: PLAN,
    sync: SYNC,
    comments,
    active_analysis_labels: ACTIVE_ANALYSIS_LABELS,
    topics: TOPICS,
    active_topic_key: TOPIC_CLASSIFICATION_KEY,
  };
}

/** `catalogue.json`, with video-1..3's titles taken from the same channel. */
export function buildCatalogue() {
  const raw = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));
  const titleById = new Map(E2E_VIDEOS.map((v) => [v.id, v.title]));
  return {
    ...raw,
    videos: raw.videos.map((v) => ({
      ...v,
      title: titleById.get(v.id) ?? v.title,
    })),
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeJson(DASHBOARD_PATH, buildDemo());
  writeJson(E2E_PATH, buildE2E());
  writeJson(CATALOGUE_PATH, buildCatalogue());
  console.log("Wrote dashboard.json, e2e-dashboard.json and catalogue.json.");
}
