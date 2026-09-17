// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import type { LabelledComment } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { ReviewDialog } from "./ReviewDialog";
import type { Snapshot } from "./Dashboard";

const baseComment = {
  id: "c1",
  text_raw: "المحتوى واضح ومفيد",
  content_purged_at: null,
  content_hash: "hash-1",
  label: "positive",
  topic: "praise",
  reviews: [],
  topic_reviews: [],
} as unknown as LabelledComment;

const topics = [
  { key: "praise", name_ar: "إشادة", name_en: "Praise", retired: false },
  {
    key: "question",
    name_ar: "استفسارات وأسئلة",
    name_en: "Questions",
    retired: false,
  },
] as unknown as Snapshot["topics"];

function renderDialog(
  overrides: Partial<Parameters<typeof ReviewDialog>[0]> = {},
) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const onVerdict = vi.fn();
  const onTopicVerdict = vi.fn();
  const onReason = vi.fn();
  // A real button in the document, standing in for the row's own "تصحيح" —
  // `onCloseAutoFocus` calls `.focus()` on it directly (see the component's
  // file comment for why that lives there rather than in `onClose`).
  const trigger = document.createElement("button");
  trigger.textContent = "تصحيح";
  document.body.appendChild(trigger);
  const triggerRef = { current: trigger };
  const props = {
    reviewing: baseComment,
    kind: "sentiment" as const,
    verdict: "positive" as const,
    onVerdict,
    topicVerdict: "praise",
    onTopicVerdict,
    reason: "",
    onReason,
    topics,
    topicName: (key: string) =>
      topics.find((t) => t.key === key)?.name_ar ?? key,
    labels: ar.labels,
    S: ar,
    lang: "ar" as const,
    persisted: true,
    busy: false,
    error: null,
    onSubmit,
    onClose,
    triggerRef,
    ...overrides,
  };
  render(
    <DirectionProvider dir="rtl">
      <ReviewDialog {...props} />
    </DirectionProvider>,
  );
  return { onSubmit, onClose, onVerdict, onTopicVerdict, onReason, trigger };
}

describe("ReviewDialog", () => {
  it("opens focused on the form itself, and shows the comment's text", async () => {
    renderDialog();
    const form = await screen.findByRole("form", {
      name: ar.reviewFormLabel,
    });
    await waitFor(() => expect(form).toHaveFocus());
    expect(screen.getByTestId("review-text")).toHaveTextContent(
      "المحتوى واضح ومفيد",
    );
  });

  it("labels the verdict select and the reason field", () => {
    renderDialog();
    expect(screen.getByLabelText(ar.correctLabel)).toHaveAttribute(
      "role",
      "combobox",
    );
    expect(screen.getByLabelText(ar.correctionReason)).toBeRequired();
  });

  it("does not submit while the reason is empty", async () => {
    const user = userEvent.setup();
    const { onSubmit, onReason } = renderDialog();
    await user.click(screen.getByRole("button", { name: ar.saveCorrection }));
    expect(onSubmit).not.toHaveBeenCalled();

    // The reason field is controlled by `Dashboard.tsx`; typing reports it
    // back through `onReason` rather than holding its own value.
    await user.type(screen.getByLabelText(ar.correctionReason), "سبب");
    expect(onReason).toHaveBeenCalled();
  });

  it("submits once, with a reason already filled in", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ reason: "سبب واضح" });
    await user.click(screen.getByRole("button", { name: ar.saveCorrection }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape, and a save in flight refuses it", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByRole("form", { name: ar.reviewFormLabel });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy: Escape does not close, and the save button is disabled", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ busy: true });
    await screen.findByRole("form", { name: ar.reviewFormLabel });
    expect(
      screen.getByRole("button", { name: ar.saveCorrection }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("once actually closed (reviewing turns null), hands focus back to triggerRef's element", async () => {
    // `renderDialog`'s `onClose` is a stub, so `open` never actually flips —
    // Radix will not unmount, and `onCloseAutoFocus` never fires. A real
    // close needs a stateful wrapper that acts on `onClose`, the same as
    // `Dashboard.tsx` does with `reviewing`/`closeReview`.
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.textContent = "تصحيح";
    document.body.appendChild(trigger);
    const triggerRef = { current: trigger };
    function Wrapper() {
      const [reviewing, setReviewing] = useState<typeof baseComment | null>(
        baseComment,
      );
      return (
        <DirectionProvider dir="rtl">
          <ReviewDialog
            reviewing={reviewing}
            kind="sentiment"
            verdict="positive"
            onVerdict={() => {}}
            topicVerdict="praise"
            onTopicVerdict={() => {}}
            reason=""
            onReason={() => {}}
            topics={topics}
            topicName={(key: string) =>
              topics.find((t) => t.key === key)?.name_ar ?? key
            }
            labels={ar.labels}
            S={ar}
            lang="ar"
            persisted
            busy={false}
            error={null}
            onSubmit={() => {}}
            onClose={() => setReviewing(null)}
            triggerRef={triggerRef}
          />
        </DirectionProvider>
      );
    }
    render(<Wrapper />);
    await screen.findByRole("form", { name: ar.reviewFormLabel });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("when the row's button has unmounted by close, falls back to the comments heading instead of <body>", async () => {
    // A save can drop the row out of the current filter (e.g. a
    // "غير المراجَع" view after the correction lands), so the button
    // `triggerRef` points at may already be gone from the document by the
    // time the dialog actually closes.
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.textContent = "تصحيح";
    document.body.appendChild(trigger);
    const triggerRef = { current: trigger };
    const heading = document.createElement("h2");
    heading.id = "rp-comments-title";
    heading.tabIndex = -1;
    document.body.appendChild(heading);
    function Wrapper() {
      const [reviewing, setReviewing] = useState<typeof baseComment | null>(
        baseComment,
      );
      return (
        <DirectionProvider dir="rtl">
          <ReviewDialog
            reviewing={reviewing}
            kind="sentiment"
            verdict="positive"
            onVerdict={() => {}}
            topicVerdict="praise"
            onTopicVerdict={() => {}}
            reason=""
            onReason={() => {}}
            topics={topics}
            topicName={(key: string) =>
              topics.find((t) => t.key === key)?.name_ar ?? key
            }
            labels={ar.labels}
            S={ar}
            lang="ar"
            persisted
            busy={false}
            error={null}
            onSubmit={() => {}}
            onClose={() => setReviewing(null)}
            triggerRef={triggerRef}
          />
        </DirectionProvider>
      );
    }
    render(<Wrapper />);
    await screen.findByRole("form", { name: ar.reviewFormLabel });
    // The row is gone before the close, not because of it.
    trigger.remove();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("renders the stale-comment error", () => {
    renderDialog({ error: new Error("stale_comment_text") });
    expect(screen.getByTestId("review-error")).toHaveTextContent(
      ar.reviewStale,
    );
  });

  it("kind=topic: titles and labels the form for the topic correction", () => {
    renderDialog({ kind: "topic" });
    expect(
      screen.getByRole("form", { name: ar.reviewTopicTitle }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(ar.correctTopicLabel)).toHaveAttribute(
      "role",
      "combobox",
    );
  });

  it("fixture mode: shows the not-persisted scope note", () => {
    renderDialog({ persisted: false });
    expect(screen.getByTestId("review-scope")).toHaveTextContent(
      ar.reviewFixtureScope,
    );
  });

  it("persisted mode: no scope note", () => {
    renderDialog({ persisted: true });
    expect(screen.queryByTestId("review-scope")).not.toBeInTheDocument();
  });

  it("closed: renders nothing reachable by role, no reviewing comment", () => {
    renderDialog({ reviewing: null });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
