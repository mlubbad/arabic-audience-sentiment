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
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Workspace = { id: string; name: string };

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

export function useWorkspaces(session: Session | null) {
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<{
    owner: string | null;
    workspaces: Workspace[];
    loading: boolean;
    failed: boolean;
  }>({ owner: null, workspaces: [], loading: false, failed: false });
  useEffect(() => {
    if (!supabase || !userId) {
      setState({ owner: null, workspaces: [], loading: false, failed: false });
      return;
    }
    const db = supabase;
    let active = true;
    setState({ owner: userId, workspaces: [], loading: true, failed: false });
    void db
      .from("workspaces")
      .select("id,name")
      .then(({ data, error }) => {
        if (!active) return;
        // A failed read leaves the list empty *and* says so. Treating it as
        // "this account has no workspaces" would send the user to create one
        // they already have.
        setState({
          owner: userId,
          workspaces: error ? [] : (data ?? []),
          loading: false,
          failed: !!error,
        });
      });
    return () => {
      active = false;
    };
  }, [userId]);
  // Auth can change before this effect runs. Never hand the next user the last
  // user's workspace list, even for a single paint or an in-flight read.
  if (state.owner !== userId)
    return { workspaces: [], loading: !!userId, failed: false };
  return state;
}
