/**
 * The «مساحة أخرى» form under the workspaces list: a name, and the one
 * button that calls `create_workspace`. The page owns the field's value and
 * the request — this is the form as a `Card`, on `ui/Input` and `ui/Button`,
 * with the page's `feedback("create")` line where the old form printed it.
 */
import type { FormEvent, ReactNode } from "react";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import "../pages.css";
import "./account.css";

export function CreateWorkspace({
  name,
  setName,
  pending,
  feedback,
  onSubmit,
  tourAnchor,
}: {
  name: string;
  setName: (name: string) => void;
  /** Something on the page is in flight: the button waits. */
  pending: boolean;
  /** The page's answer to the last press — its `feedback("create")`. */
  feedback: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** The onboarding tour's `data-tour` name: this card stands in for the
   *  workspace card when the reader has none yet. */
  tourAnchor?: string;
}) {
  const S = useStrings();
  return (
    <Card asChild className="db-create" data-tour={tourAnchor}>
      <form onSubmit={onSubmit}>
        <h2>{S.anotherWorkspaceTitle}</h2>
        <p className="db-lead">{S.anotherWorkspaceLead}</p>
        <div className="ui-field">
          <label htmlFor="create-workspace-name">{S.workspaceNameLabel}</label>
          <Input
            id="create-workspace-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {feedback}
        <Button type="submit" disabled={pending}>
          {S.createWorkspace}
        </Button>
      </form>
    </Card>
  );
}
