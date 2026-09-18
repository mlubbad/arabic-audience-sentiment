/**
 * The three steps with a state on each — the list itself, once.
 *
 * The account page's workspace card renders it, and so does the overview when
 * a workspace has no comments yet: the audit's point was that an empty
 * dashboard is the first screen every new reader sees, and it showed them an
 * apology with two links where the path they are on should be. Both places
 * read this component, so the path is drawn one way.
 *
 * Restyled on tokens in its own sheet (phase 5): `setup-path` on the `ol`,
 * `setup-step` + `data-status` on each `li`, `setup-step-state` on the state
 * word — replacing `account-steps`/`setup-steps`, the rules `app.css` used
 * to carry for `account/Account.tsx`'s own static list before it was
 * recomposed.
 */
import "./setup-path.css";
import type { SetupStep } from "./setup";
import { useStrings, type StringKey } from "./strings";

const stepWords: Record<SetupStep["status"], StringKey> = {
  done: "stepStateDone",
  next: "stepStateNext",
  later: "stepStateLater",
  pending: "stepStatePending",
  attention: "stepStateAttention",
};

export function SetupPath({
  steps,
  testId,
  tourAnchor,
}: {
  steps: SetupStep[];
  testId?: string;
  /** The onboarding tour's `data-tour` name for this list, when it is the
   *  one the tour lights. */
  tourAnchor?: string;
}) {
  const S = useStrings();
  return (
    <ol
      className="setup-path"
      data-testid={testId}
      data-tour={tourAnchor}
      aria-label={S.stepsLabel}
    >
      {steps.map((step) => (
        <li
          key={step.key}
          className="setup-step"
          data-status={step.status}
          aria-current={step.status === "next" ? "step" : undefined}
        >
          <span className="setup-step-state">{S[stepWords[step.status]]}</span>
          <span>{step.title}</span>
          {step.detail && <small>{step.detail}</small>}
        </li>
      ))}
    </ol>
  );
}
