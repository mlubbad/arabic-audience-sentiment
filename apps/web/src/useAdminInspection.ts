import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useSession, useWorkspaces } from "./session";
import { useIsPlatformAdmin } from "./adminAccess";
import { useImpersonation } from "./impersonation";
import { workspaceFromSearch } from "./workspaceUrl";
import { supabase } from "./supabase";

export function useAdminInspection() {
  const [searchParams] = useSearchParams();
  const { session } = useSession();
  const { isImpersonating } = useImpersonation();
  const { data: isAdmin } = useIsPlatformAdmin(session);
  const { workspaces } = useWorkspaces(session);
  const wsId = workspaceFromSearch(searchParams);

  // When impersonating a specific user, the impersonation banner takes precedence
  if (isImpersonating) {
    return {
      isInspecting: false,
      workspaceId: null,
      workspaceName: null,
    };
  }

  // Check if it's among the user's regular workspaces
  const foundInOwn = workspaces.find((w) => w.id === wsId);

  // If admin is viewing a workspace, query its details
  const { data: wsDetails } = useQuery({
    queryKey: ["inspect_workspace", wsId],
    enabled: !!isAdmin && !!wsId && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("workspaces")
        .select("id, name, created_by")
        .eq("id", wsId!)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    },
  });

  const activeWs = foundInOwn ?? wsDetails;
  const isInspecting =
    Boolean(isAdmin) &&
    Boolean(activeWs) &&
    Boolean(activeWs?.created_by) &&
    activeWs?.created_by !== session?.user.id;

  return {
    isInspecting,
    workspaceId: wsId,
    workspaceName: activeWs?.name ?? null,
  };
}
