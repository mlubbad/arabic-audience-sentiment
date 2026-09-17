/**
 * The most-engaged negative comments — one `Card` row per comment on an
 * `<ol>`, so each row still carries `role="listitem"`: the browser suite
 * counts them off `engaged-panel` (`getByTestId("engaged-panel").getByRole
 * ("listitem")`), which only holds if the list stays a real list and the
 * `data-testid` stays on the `<li>`, not just on the `Card` inside it.
 *
 * The like count is a `Badge numeric` (tone `negative`, matching the old
 * inline colour); the unit word beside it is plain text, not part of the
 * badge — running the numeral font over an Arabic word would be a rendering
 * defect, not a style choice, on a page that already tracks that distinction
 * elsewhere (`n()`/`.ui-num`).
 *
 * The brief's signature lists a trailing `lang`; nothing in the moved
 * markup ever read it (no date is shown in this section), so it is dropped
 * here rather than carried as an unused prop — the same call Task 7 made
 * for `Voice`'s unused `lang`.
 */
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { commentText } from "../i18n";
import "./engaged.css";

export function Engaged({ s, S }: { s: Snapshot; S: Strings }) {
  return (
    <section
      className="db-section"
      id="rp-engaged"
      aria-labelledby="engaged-heading"
      data-testid="engaged-panel"
    >
      <header>
        <h2 id="engaged-heading">{S.engagedTitle}</h2>
      </header>
      <p className="db-muted">{S.engagedLead}</p>
      {s.most_engaged_negative.length === 0 ? (
        <p data-testid="engaged-empty">{S.engagedEmpty}</p>
      ) : (
        /* A heading promising a ranking, over a run of sentences that began
           with a number. Ranked things want a rank: the count is the mark,
           the text is the row, and the bar under each is that row's share
           of the top one — which is the only reason to order them in the
           first place. */
        <ol className="db-engaged">
          {s.most_engaged_negative.map((c) => {
            const top = s.most_engaged_negative[0].likes_value ?? 0;
            const likes = c.likes_value ?? 0;
            return (
              <li key={c.id} data-testid={`engaged-${c.id}`}>
                <Card className="db-engaged-row">
                  <span className="db-engaged-count">
                    <Badge numeric tone="negative">
                      {c.likes_raw ?? c.likes_value}
                    </Badge>
                    <span className="db-engaged-unit">{S.unitLikes}</span>
                  </span>
                  <span className="db-engaged-body">
                    <span className="db-engaged-text">{commentText(c, S)}</span>
                    {c.reviewed && <small>{S.humanReview}</small>}
                    <span
                      className="db-engaged-bar"
                      aria-hidden="true"
                      style={{
                        // Relative to the most-liked row, not to the page:
                        // these five are the top of a longer list, and a
                        // bar drawn against a total the reader cannot see
                        // measures nothing.
                        inlineSize: `${top > 0 ? Math.max((likes / top) * 100, 2) : 0}%`,
                      }}
                    />
                  </span>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      {s.negative_ranked > s.most_engaged_negative.length && (
        <p className="db-muted" data-testid="engaged-truncated">
          {S.engagedTruncated(
            s.most_engaged_negative.length,
            s.negative_ranked,
          )}
        </p>
      )}
      {s.negative_unranked > 0 && (
        <p className="db-muted" data-testid="engaged-unranked">
          {S.engagedUnranked(s.negative_unranked)}
        </p>
      )}
    </section>
  );
}
