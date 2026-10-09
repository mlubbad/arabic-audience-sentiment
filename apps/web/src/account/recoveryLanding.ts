/**
 * Where a password recovery link lands, and the shell's hook that takes a
 * reader there. Its own module, not `ResetPassword.tsx`, so the shell does
 * not pull the reset page into the main chunk.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { supabase } from "../supabase";

export const RESET_PATH = "/reset-password";

/** Was this page load a recovery link? Read from the address when the module
 *  loads, before the client consumes it: the implicit flow puts
 *  `type=recovery` in the hash. Cleared once acted on, so a reader who set
 *  their password and moved on is not sent back. */
let pending =
  typeof window !== "undefined" &&
  /(?:^|[#&])type=recovery(?:&|$)/.test(window.location.hash);

/** In the shell: a reader a recovery link signed in anywhere but the reset
 *  page is taken there, to choose their new password. Supabase lands the
 *  link on the site's root when `/reset-password` is not on the project's
 *  redirect list. */
export function useRecoveryLanding(pathname: string) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!pending) return;
    pending = false;
    if (pathname !== RESET_PATH) navigate(RESET_PATH, { replace: true });
  }, [pathname, navigate]);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "PASSWORD_RECOVERY" &&
        window.location.pathname !== RESET_PATH
      )
        navigate(RESET_PATH, { replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);
}
