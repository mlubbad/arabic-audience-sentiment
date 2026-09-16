/**
 * The plan of the workspace the reader chose, read once for every surface
 * that shows it.
 *
 * The rail card and the account's plan panel both need the same three
 * answers — which workspace the selection resolves to, whether there is one
 * to query, and what `usage_summary` says about it — and each had written
 * the block itself. One query key, `["plan", userId, workspaceId]`, so the
 * two share a cache entry: the panel opening does not refetch what the card
 * beside it already holds, and an invalidation reaches both.
 */
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { UsageSummarySchema } from "@sentiment/contracts";
import { useWorkspaceSelection } from "./workspaceSelection";
import { workspaceState, type WorkspaceOption } from "./workspace";
import { configuredMode, fixtureWorkspace } from "./data";
import { supabase } from "./supabase";

export function usePlanUsage(
  session: Session | null,
  workspaces: WorkspaceOption[],
) {
  const userId = session?.user.id ?? null;
  const [chosen] = useWorkspaceSelection(userId);
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  const workspaceId = place.kind === "ready" ? place.id : null;
  const plan = useQuery({
    queryKey: ["plan", userId, workspaceId],
    enabled: !!supabase && !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("usage_summary", {
        w: workspaceId,
      });
      if (error) throw new Error("plan_unavailable");
      return UsageSummarySchema.nullable().parse(data);
    },
  });
  return { place, workspaceId, plan };
}
