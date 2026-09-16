import { Link } from "react-router";
import { useSession, useWorkspaces } from "./session";
import { configuredMode } from "./data";
import { usePlanUsage } from "./planUsage";
import { planCardWords } from "./planWords";
import { useStrings } from "./strings";
import { useLocale } from "./locale";

/** What the plan has left, where it is true: on every screen.
 *  It used to live inside the operations page, which meant the one number a
 *  reader needs before starting work was behind the page they visit when
 *  something has already gone wrong. Then, for a while, this card pointed at
 *  that page instead of carrying the number — a signpost where the figure
 *  should be. It reads `usage_summary` for the chosen workspace and says
 *  what is left of the analysis budget; the rest stays on the operations
 *  page. */
export function PlanCard() {
  const { session } = useSession();
  const {
    workspaces,
    loading: listLoading,
    failed: listFailed,
  } = useWorkspaces(session);
  const { place, workspaceId, plan } = usePlanUsage(session, workspaces);
  const S = useStrings();
  const locale = useLocale();
  if (!session || configuredMode !== "live") return null;
  const words = planCardWords(
    {
      workspaceName: place.kind === "ready" ? place.name : null,
      choosing: place.kind === "choose",
      loading: listLoading || (!!workspaceId && plan.isPending),
      failed: listFailed || plan.isError,
      plan: plan.data ?? null,
    },
    S,
    locale,
  );
  return (
    <Link className="app-plan" to="/sync" data-tone={words.tone}>
      <span className="app-plan-kicker">{words.kicker}</span>
      <strong>{words.title}</strong>
      {words.note && <span className="app-plan-note">{words.note}</span>}
    </Link>
  );
}
