/**
 * Whether you are signed in, and the one control that changes it.
 *
 * This belongs in the chrome, not on a page. Signing out lived in the body of
 * the account page, which meant leaving required first navigating to a
 * settings screen — and signing in was reachable only by guessing that the
 * item called "الحساب ومساحات العمل" was also the front door. Session state is
 * true of every route, so it is shown on every route.
 *
 * It takes the slot a decorative line was using ("فهم أوضح لكل تعليق"), which
 * is the trade this header needed: the tagline is on the landing page, where
 * someone is still deciding, and by the time a reader is inside the product
 * they have decided.
 *
 * Its own file, apart from main.tsx: that module calls createRoot().render()
 * at load, so nothing can import it in a test — the same reason the rail's
 * state lives in RailState.tsx.
 */
import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "./session";
import { supabase } from "./supabase";
import { useStrings } from "./strings";

export function SessionControl() {
  const { session, loading } = useSession();
  const S = useStrings();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nothing at all until it is known. A "sign in" that flips to "sign out" a
  // moment later reads as the page changing its mind about who you are.
  if (loading) return null;
  if (!session)
    return (
      <Link className="app-session app-session-in" to="/account">
        {S.signIn}
      </Link>
    );
  return (
    <div className="app-session">
      <span className="app-session-who" title={session.user.email ?? undefined}>
        {session.user.email ?? S.yourAccount}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!supabase) return;
          setBusy(true);
          setFailed(false);
          void supabase.auth.signOut().then(({ error }) => {
            setBusy(false);
            // Said, not swallowed: a sign-out that quietly failed leaves the
            // reader believing they have left a shared screen.
            if (error) setFailed(true);
          });
        }}
      >
        {busy ? S.signingOut : S.signOut}
      </button>
      {failed && (
        <span role="alert" className="app-session-error">
          {S.signOutFailed}
        </span>
      )}
    </div>
  );
}
