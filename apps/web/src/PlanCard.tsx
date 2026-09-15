import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { UsageSummarySchema } from "@sentiment/contracts";
import { useSession, useWorkspaces } from "./session";
import { useWorkspaceSelection } from "./workspaceSelection";
import { workspaceState } from "./workspace";
import { configuredMode, fixtureWorkspace } from "./data";
import { planCardWords } from "./planWords";
import { useStrings } from "./strings";
import { supabase } from "./supabase";

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
  const [chosen] = useWorkspaceSelection(session?.user.id ?? null);
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  const workspaceId = place.kind === "ready" ? place.id : null;
  const plan = useQuery({
    queryKey: ["plan", session?.user.id ?? null, workspaceId],
    enabled: !!supabase && !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("usage_summary", {
        w: workspaceId,
      });
      if (error) throw new Error("plan_unavailable");
      return UsageSummarySchema.nullable().parse(data);
    },
  });
  const S = useStrings();
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
  );
  return (
    <Link className="app-plan" to="/sync" data-tone={words.tone}>
      <span className="app-plan-kicker">{words.kicker}</span>
      <strong>{words.title}</strong>
      {words.note && <span className="app-plan-note">{words.note}</span>}
    </Link>
  );
}
