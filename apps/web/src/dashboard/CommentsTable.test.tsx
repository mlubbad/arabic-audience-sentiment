// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { LabelledComment } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import type { Snapshot } from "./Dashboard";
import { CommentsTable } from "./CommentsTable";

const commentWithReplies = {
  id: "c1",
  author_name: "مستخدم تجريبي",
  text: "تعليق رائع ومفيد جداً",
  published_at: "2026-10-01T12:00:00Z",
  likes_value: 10,
  reply_count: 5,
  is_reply: false,
  label: "positive",
  reviewed: false,
  prediction: {
    status: "succeeded",
    label: "positive",
    content_hash: "ch1",
    analysis_key: "ak1",
    model_id: "m1",
    revision: "rev1",
    preprocessing_version: "pv1",
    predicted_at: "2026-10-01T12:00:00Z",
    class_scores: { positive: 0.85, negative: 0.05, neutral: 0.1, mixed: 0 },
  },
} as unknown as LabelledComment;

const snapshot = {
  total: 1,
  analysed: 1,
  unanalysed: 0,
  active_topic_key: null,
  comments: [commentWithReplies],
} as unknown as Snapshot;

describe("CommentsTable", () => {
  it("renders reply count without duplication in Arabic", () => {
    render(
      <CommentsTable
        s={snapshot}
        S={ar}
        labels={ar.labels}
        topicName={(k) => k}
        lang="ar"
        onReview={() => {}}
        onTopicReview={() => {}}
      />,
    );

    // Should render "(5 ردود)" and NOT "(5 5 ردود)"
    const replyBadges = document.querySelectorAll(".db-comment-replies-badge");
    expect(replyBadges.length).toBeGreaterThan(0);
    for (const badge of replyBadges) {
      expect(badge.textContent?.trim()).toBe(`(${ar.countReplies("5")})`);
      expect(badge.textContent).not.toContain("5 5");
    }
  });

  it("renders reply count without duplication in English", () => {
    render(
      <CommentsTable
        s={snapshot}
        S={en}
        labels={en.labels}
        topicName={(k) => k}
        lang="en"
        onReview={() => {}}
        onTopicReview={() => {}}
      />,
    );

    const replyBadges = document.querySelectorAll(".db-comment-replies-badge");
    expect(replyBadges.length).toBeGreaterThan(0);
    for (const badge of replyBadges) {
      expect(badge.textContent?.trim()).toBe(`(${en.countReplies("5")})`);
      expect(badge.textContent).not.toContain("5 5");
    }
  });

  it("renders confidence score with locale-aware percent sign", () => {
    const { unmount } = render(
      <CommentsTable
        s={snapshot}
        S={ar}
        labels={ar.labels}
        topicName={(k) => k}
        lang="ar"
        onReview={() => {}}
        onTopicReview={() => {}}
      />,
    );
    const scoreChipsAr = document.querySelectorAll(".db-chip-score");
    expect(scoreChipsAr.length).toBeGreaterThan(0);
    expect(scoreChipsAr[0].textContent).toBe("85٪");

    unmount();

    render(
      <CommentsTable
        s={snapshot}
        S={en}
        labels={en.labels}
        topicName={(k) => k}
        lang="en"
        onReview={() => {}}
        onTopicReview={() => {}}
      />,
    );
    const scoreChipsEn = document.querySelectorAll(".db-chip-score");
    expect(scoreChipsEn.length).toBeGreaterThan(0);
    expect(scoreChipsEn[0].textContent).toBe("85%");
  });
});
