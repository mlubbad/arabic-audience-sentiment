/**
 * The states a signed-in page passes through before it has a workspace to
 * show — once, for both pages that have them.
 *
 * The overview and the operations page asked the same four questions on the
 * way in (still loading? failed? no workspace? more than one?) and answered
 * each in its own markup: one used `.notice` with a bare `<h1>`, the other
 * `.app-state` with a symbol, an eyebrow and a lead sentence. Same meaning,
 * two implementations — the shape that has produced six of this codebase's
 * bugs, and this was the seventh. A reader who chose a workspace on one page
 * and was asked again on the next, in a different-looking box, had reason to
 * think the second was a different question.
 *
 * The richer of the two survives, per the rule in `docs/coordination/ACTIVE.md`:
 * a merged reader may drop wording only where it has something more specific
 * to say. Everything page-specific — what the page is called, how it phrases
 * the choice — comes in as words, not as markup.
 */
import type { ReactNode } from "react";
import type { WorkspaceOption, WorkspaceState } from "./workspace";

export type GateWords = {
  /** The page's own name, as the rail calls it. */
  eyebrow: string;
  /** The question, phrased for what this page does with the answer. */
  chooseTitle: string;
  chooseLead: string;
  /** Kept per page so an existing locator keeps finding its box. */
  chooseTestId: string;
};

export function WorkspaceGate({
  sessionLoading,
  live,
  workspacesLoading,
  workspacesFailed,
  place,
  chosen,
  onChoose,
  words,
  children,
}: {
  sessionLoading: boolean;
  /** Live data and a signed-in reader: the only case with a list to wait for,
   *  fail on, or choose from. Fixture mode and visitors pass straight through. */
  live: boolean;
  workspacesLoading: boolean;
  workspacesFailed: boolean;
  place: WorkspaceState;
  chosen: string | null;
  onChoose: (id: string | null) => void;
  words: GateWords;
  children: ReactNode;
}) {
  if (sessionLoading)
    return (
      <div className="app-state" role="status">
        جارٍ تحديد حسابك…
      </div>
    );
  if (live) {
    if (workspacesLoading)
      return (
        <div className="app-state" role="status">
          جارٍ تحميل مساحات العمل…
        </div>
      );
    if (workspacesFailed)
      return (
        <div className="app-state" role="alert">
          <h1>تعذّرت قراءة مساحات عملك.</h1>
          <p>
            حدّث الصفحة لإعادة المحاولة؛ لا يمكن عرض بيانات تجربة بدل بيانات
            حسابك.
          </p>
        </div>
      );
    if (place.kind === "no_workspaces")
      return (
        <div className="app-state">
          <h1>لا توجد مساحة عمل لهذا الحساب بعد.</h1>
          <div className="app-state-actions">
            <a href="/account">أنشئ مساحة عمل من صفحة الحساب</a>
          </div>
        </div>
      );
    if (place.kind === "choose")
      return (
        <WorkspaceChoice
          options={place.options}
          chosen={chosen}
          onChoose={onChoose}
          words={words}
        />
      );
  }
  return <>{children}</>;
}

function WorkspaceChoice({
  options,
  chosen,
  onChoose,
  words,
}: {
  options: WorkspaceOption[];
  chosen: string | null;
  onChoose: (id: string | null) => void;
  words: GateWords;
}) {
  return (
    <div className="app-state" data-testid={words.chooseTestId}>
      <span className="app-state-symbol" aria-hidden="true">
        ↗
      </span>
      <p className="app-eyebrow">{words.eyebrow}</p>
      <h1>{words.chooseTitle}</h1>
      <p>{words.chooseLead}</p>
      <label className="sync-choice">
        مساحة العمل
        <select
          value={chosen ?? ""}
          onChange={(e) => onChoose(e.target.value || null)}
        >
          <option value="">— اختر —</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
