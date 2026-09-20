/**
 * The player: a video from the catalogue, watched here, on `ui/Dialog`.
 *
 * Nothing is embedded until a video is open — the iframe exists only while
 * `video` is set, so a page of thumbnails costs no embeds and closing the
 * dialog unloads the player. The embed is the privacy-enhanced host from
 * `videoLinks`, which sets no cookie until the viewer presses play.
 *
 * Presentational: the owner (`Catalogue`) holds which video is open and is
 * asked, through `onClose`, whenever Radix would close — Escape, the
 * overlay and the corner ✕ (the one close button, `cat-preview-close`) all
 * route through `onOpenChange(false)`. Focus lands on the panel itself when it
 * opens, not inside the iframe (see `onOpenAutoFocus`), and goes back to
 * the row's own play button on close: that button is not a Radix trigger,
 * so the owner hands it in as `returnTo` and the dialog puts focus there.
 */
import { useRef, type RefObject } from "react";
import type { CatalogueVideo } from "@sentiment/contracts";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { videoLinks } from "../catalogue";
import type { Strings } from "../strings";

export function CataloguePreview({
  video,
  kindLabel,
  onClose,
  returnTo,
  S,
}: {
  video: CatalogueVideo | null;
  /** The kind, already in the reader's words — the owner has the table. */
  kindLabel: string;
  onClose: () => void;
  /** The button that opened the player, if any: focus returns to it. A ref,
   *  read only when the dialog closes — never during a render. */
  returnTo?: RefObject<HTMLElement | null>;
  S: Strings;
}) {
  const content = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog
      open={!!video}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {video && (
        <DialogContent
          className="db-preview"
          data-testid="cat-preview"
          closeLabel={S.catClose}
          closeTestId="cat-preview-close"
          aria-describedby={undefined}
          ref={content}
          onOpenAutoFocus={(e) => {
            // Radix would focus the first tabbable thing inside, which is
            // the iframe — and a key pressed inside YouTube's document
            // never reaches this one, so Escape would stop working the
            // moment the player opened. The panel takes focus instead; Tab
            // still reaches the frame and the buttons.
            e.preventDefault();
            content.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            const back = returnTo?.current;
            if (back && document.body.contains(back)) {
              e.preventDefault();
              back.focus();
            }
          }}
        >
          <DialogTitle asChild>
            <h3 className="db-preview-title">{video.title}</h3>
          </DialogTitle>
          <iframe
            className="db-preview-frame"
            data-testid="cat-preview-frame"
            src={
              videoLinks(video.external_video_id, video.kind, video.platform)
                .embed ?? undefined
            }
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <footer className="db-preview-foot">
            <span>
              {kindLabel}
              {" · "}
              {video.reported_comment_count === null
                ? S.catCountUnknown
                : video.reported_comment_count}
            </span>
            <a
              href={
                videoLinks(video.external_video_id, video.kind, video.platform)
                  .watch
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {video.platform === "telegram"
                ? S.catOpenTelegram
                : video.platform === "x"
                  ? S.catOpenX
                  : video.platform === "tiktok"
                    ? S.catOpenTikTok
                    : S.catOpenYouTube}{" "}
              ↗
            </a>
            <small className="db-note">{S.catPreviewHint}</small>
          </footer>
        </DialogContent>
      )}
    </Dialog>
  );
}
