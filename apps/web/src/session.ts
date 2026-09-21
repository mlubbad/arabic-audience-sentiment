/**
 * Who is signed in, and which workspaces are theirs.
 *
 * Three screens needed this and two had already written their own copy of it,
 * which is how the dashboard came to have no idea a user was signed in while
 * the account page next to it did.
 *
 * The workspace list is read through RLS with the user's own token, so it is
 * the set they are entitled to and not a set this code filtered.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Workspace = { id: string; name: string; created_by?: string };

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  // Starts true only when there is something to wait for. With Supabase
  // unconfigured there is no session to load, and reporting "loading" forever
  // would hold every caller on a spinner.
  const [loading, setLoading] = useState(!!supabase);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return { session, loading };
}

/** The key every reader of the list shares. Invalidate it after any call
 * that changes the rows — create, rename, retire, delete — and the rail's
 * switch, the dashboard and the plan card all re-read at once. Before this,
 * each held a private copy in `useState`, and a workspace deleted on the
 * admin page stayed in the switch until the tab was reloaded. */
export const workspacesKey = (userId: string | null) =>
  ["workspaces", userId] as const;

export function useWorkspaces(session: Session | null) {
  const userId = session?.user.id ?? null;
  const query = useQuery({
    queryKey: workspacesKey(userId),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("workspaces")
        .select("id,name,created_by");
      if (error) throw error;
      return (data ?? []) as Workspace[];
    },
    enabled: !!supabase && !!userId,
  });
  // The key carries the user id, so a change of user is a change of query:
  // the next user never sees the last user's list, even for one paint.
  if (!supabase || !userId)
    return { workspaces: [], loading: false, failed: false };
  // A failed read leaves the list empty *and* says so. Treating it as "this
  // account has no workspaces" would send the user to create one they
  // already have.
  return {
    workspaces: query.data ?? [],
    loading: query.isPending,
    failed: query.isError,
  };
}
