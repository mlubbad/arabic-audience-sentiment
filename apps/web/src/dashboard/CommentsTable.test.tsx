// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "../strings/en";
import type { Snapshot } from "./Dashboard";
import { CommentsTable } from "./CommentsTable";

const comment = {
  id: "c1",
  workspace_id: "w",
  video_id: "v",
  author_name: "Reader",
  text_raw: "hello",
  published_at: "2026-10-01T00:00:00Z",
  is_reply: false,
  reply_count: 5,
  label: null,
  reviewed: false,
};

describe("CommentsTable", () => {
  it("says the reply count once: (5 replies), not (5 5 replies)", () => {
    render(
      <CommentsTable
        s={{ comments: [comment] } as unknown as Snapshot}
        S={en}
        lang="en"
        labels={en.labels}
        topicName={(k) => k}
        onReview={() => {}}
        onTopicReview={() => {}}
      />,
    );
    const badge = screen.getByText(/replies\)/);
    expect(badge).toHaveTextContent(/^\(5 replies\)$/);
  });
});
