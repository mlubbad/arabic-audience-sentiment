/**
 * Choosing one Facebook page when the account manages several.
 *
 * Meta lets a person allow several pages at once; the product follows one
 * page per workspace. Rather than send them back through Meta's "Edit
 * settings" screen, the ticket waits and this list asks. It shows names only:
 * the page tokens never leave the database.
 */
import { useEffect, useState } from "react";
import {
  completePendingConnection,
  listPageChoices,
  type PageChoice,
  type PendingCompletion,
} from "./connectResult";
import { useStrings } from "./strings";
import { Button } from "./ui/Button";

export function PageChooser({
  ticket,
  onDone,
}: {
  ticket: string;
  /** The completion's answer once a page was chosen (or the list failed). */
  onDone: (completion: PendingCompletion) => void;
}) {
  const S = useStrings();
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void listPageChoices(ticket).then((out) => {
      if (!live) return;
      if (out.kind === "choices") setChoices(out.choices);
      else onDone(out);
    });
    return () => {
      live = false;
    };
  }, [ticket, onDone]);

  if (!choices)
    return (
      <p className="db-muted" role="status">
        {S.crChoosePageLoading}
      </p>
    );

  return (
    <ul className="page-chooser" role="list" data-testid="page-chooser">
      {choices.map((c) => (
        <li key={c.id}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void completePendingConnection(ticket, c.id).then((out) => {
                setBusy(false);
                onDone(out);
              });
            }}
          >
            <bdi>{c.title ?? c.handle ?? c.external_channel}</bdi>
            {c.handle && c.title && (
              <small className="db-muted">
                {" "}
                <bdi>@{c.handle.replace(/^@/, "")}</bdi>
              </small>
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}
