/**
 * Whether the signed-in reader is a platform admin, asked once.
 *
 * The rail's link to `/admin` and the page behind it both need the answer,
 * and the answer must not be minted in the browser: it is `is_platform_admin()`,
 * a row in a private table read under the reader's own token. One query key,
 * `["is_admin", userId]`, so the link and the page share a cache entry, and a
 * reader who is not signed in asks nothing at all.
 */
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useIsPlatformAdmin(session: Session | null) {
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: ["is_admin", userId],
    enabled: !!supabase && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("is_platform_admin");
      // The reason is not surfaced: a PostgREST error can carry the request URL.
      if (error) throw new Error("admin_unavailable");
      return data === true;
    },
  });
}
