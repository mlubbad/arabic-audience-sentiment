/**
 * The three steps with a state on each — the list itself, once.
 *
 * The account page's workspace card renders it, and so does the overview when
 * a workspace has no comments yet: the audit's point was that an empty
 * dashboard is the first screen every new reader sees, and it showed them an
 * apology with two links where the path they are on should be. Both places
 * read this component, so the path is drawn one way.
 */
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
}: {
  steps: SetupStep[];
  testId?: string;
}) {
  const S = useStrings();
  return (
    <ol
      className="account-steps setup-steps"
      data-testid={testId}
      aria-label={S.stepsLabel}
    >
      {steps.map((step) => (
        <li
          key={step.key}
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
