// @vitest-environment jsdom
/** The player, on `ui/Dialog`: nothing embedded until a video is open, the
 *  title as the dialog's h3, the privacy-enhanced embed, and two ways out —
 *  Escape and the close button — both of which ask the owner to close. */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogueVideo } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { CataloguePreview } from "./CataloguePreview";

const video: CatalogueVideo = {
  id: "video-3",
  external_video_id: "fixture0003",
  title: "بث مباشر: نجاوب على أسئلتكم عن اللابتوبات قبل الدراسة",
  kind: "stream",
  published_at: "2026-09-05T18:00:00Z",
  thumbnail_url: null,
  reported_comment_count: 18,
  comments_state: "open",
  collected: 0,
  selected: false,
  last_collected_at: null,
  last_outcome: null,
  next_check_at: null,
};

const open = (onClose = vi.fn()) => {
  render(
    <CataloguePreview
      video={video}
      kindLabel={ar.catKindStream}
      onClose={onClose}
      S={ar}
    />,
  );
  return onClose;
};

describe("CataloguePreview", () => {
  it("embeds nothing while no video is open", () => {
    render(
      <CataloguePreview video={null} kindLabel="" onClose={vi.fn()} S={ar} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cat-preview-frame")).not.toBeInTheDocument();
  });

  it("opens as a dialog headed by the title, with the privacy-enhanced embed", () => {
    open();
    const dialog = screen.getByTestId("cat-preview");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(within(dialog).getByRole("heading", { level: 3 })).toHaveTextContent(
      video.title,
    );
    expect(screen.getByTestId("cat-preview-frame")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/fixture0003?autoplay=1&rel=0",
    );
    // The way out to YouTube itself, in a new tab.
    expect(
      within(dialog).getByRole("link", { name: `${ar.catOpenYouTube} ↗` }),
    ).toHaveAttribute("href", "https://www.youtube.com/watch?v=fixture0003");
  });

  it("Escape asks the owner to close", async () => {
    const onClose = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the close button asks the owner to close", async () => {
    const onClose = open();
    await userEvent.click(screen.getByTestId("cat-preview-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
