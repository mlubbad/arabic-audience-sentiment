/**
 * Who is talking, ranked — `ui/Tabs` choosing the question (volume, or
 * reach), the ranked list as `Card` rows on an `<ol>`.
 *
 * The ranking itself (`people`, sorted by `by`) is computed in
 * `Dashboard.tsx` and passed down whole: it is the one place that also owns
 * `rows`, and re-deriving it here from a second copy of `commenters()` would
 * be the "one meaning, two implementations" shape the onboarding notes warn
 * about. `by`/`onBy` mirror that: the tab *is* the sort, not a filter beside
 * it, so the selected value lives in `Dashboard.tsx` next to the `useMemo`
 * it drives.
 *
 * Both `TabsContent`s render the same list markup, reading the one `people`
 * prop — the prop already reflects whichever `by` is current, so there is
 * nothing tab-specific to branch on beyond which content Radix shows.
 *
 * The brief's signature lists a leading `s` (the snapshot) alongside
 * `people`; nothing in the moved markup ever read anything off `s` directly
 * (only off the already-derived `people`), so it is dropped here rather than
 * carried as an unused prop — the same call Task 7 made for `Voice`'s unused
 * `lang`.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import type { Strings } from "../strings";
import type { Commenters } from "../analytics";
import { n } from "./format";
import { ChartEmpty } from "./PageStates";
import "./people.css";

export function People({
  S,
  people,
  by,
  onBy,
}: {
  S: Strings;
  people: Commenters;
  by: "comments" | "likes";
  onBy: (by: "comments" | "likes") => void;
}) {
  const list = (
    <>
      {people.ranked.length === 0 ? (
        <ChartEmpty>
          <strong>{S.noCommenterStrong}</strong>
          {S.noCommenterLead}
        </ChartEmpty>
      ) : (
        <ol className="db-ranked">
          {people.ranked.slice(0, 20).map((c, i) => (
            <li key={c.key} data-testid={`rp-person-${i}`}>
              <Card className="db-person">
                <span className="db-rank">{i + 1}</span>
                <span className="db-person-name">{c.name}</span>
                <Badge numeric>{S.countComments(n(c.comments))}</Badge>
                <span className="db-person-likes">
                  {/* Unknown stays unknown: a source that showed no count is
                      not a source that showed zero. */}
                  {c.likes === null ? S.likesUnknown : S.countLikes(n(c.likes))}
                </span>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {people.anonymous > 0 && (
        <p className="db-note" data-testid="rp-anonymous">
          {S.anonymousNote(n(people.anonymous))}
        </p>
      )}
    </>
  );
  return (
    <section className="db-section" id="rp-people">
      <header>
        <h2>{S.secPeople}</h2>
        <p className="db-lead">{S.peopleLead}</p>
      </header>
      <Tabs value={by} onValueChange={(v) => onBy(v as "comments" | "likes")}>
        <TabsList className="db-people-tabs" aria-label={S.secPeople}>
          <TabsTrigger value="comments">{S.mostActive}</TabsTrigger>
          <TabsTrigger value="likes">{S.mostInfluential}</TabsTrigger>
        </TabsList>
        <TabsContent value="comments">{list}</TabsContent>
        <TabsContent value="likes">{list}</TabsContent>
      </Tabs>
    </section>
  );
}
