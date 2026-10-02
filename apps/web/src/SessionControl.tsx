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
import { useImpersonation } from "./impersonation";
import { supabase } from "./supabase";
import { useStrings } from "./strings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

export function SessionControl() {
  const { session, loading } = useSession();
  const {
    isImpersonating,
    impersonatedUser,
    stopImpersonation,
    loading: impLoading,
  } = useImpersonation();
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

  const displayEmail = isImpersonating
    ? (impersonatedUser?.email ?? S.yourAccount)
    : (session.user.email ?? S.yourAccount);

  return (
    <div className="app-session" data-testid="app-session">
      <DropdownMenu>
        {/* A plain button, deliberately: app.css already paints any button
            inside .app-rail .app-session as the rail's translucent pill in
            --ink-on-dark. The light ui-btn box belongs on cards, not here.
            The menu itself portals to <body> and wears ui/'s light panel. */}
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={displayEmail}
            className={
              isImpersonating ? "app-session-trigger--impersonating" : undefined
            }
          >
            {isImpersonating && <span aria-hidden="true">🎭 </span>}
            <span className="app-session-who">{displayEmail}</span>
            {isImpersonating && (
              <span className="app-session-impersonate-tag">
                ({S.adminImpersonationActive})
              </span>
            )}
            <span aria-hidden="true"> ▾</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/account">{S.yourAccount}</Link>
          </DropdownMenuItem>
          {isImpersonating && (
            <DropdownMenuItem
              disabled={impLoading}
              onSelect={() => void stopImpersonation()}
              data-testid="session-return-admin"
            >
              {impLoading
                ? S.adminImpersonateStopping
                : S.adminImpersonationExitAction}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={busy || impLoading}
            data-testid="session-signout"
            onSelect={() => {
              // When impersonating, signing out exits the impersonated session and returns to admin
              if (isImpersonating) {
                void stopImpersonation();
                return;
              }
              if (!supabase) return;
              setBusy(true);
              setFailed(false);
              void supabase.auth.signOut().then(({ error }) => {
                setBusy(false);
                // Said, not swallowed: a sign-out that quietly failed leaves
                // the reader believing they have left a shared screen.
                if (error) setFailed(true);
              });
            }}
          >
            {busy ? S.signingOut : S.signOut}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <span role="alert" className="app-session-error">
          {S.signOutFailed}
        </span>
      )}
    </div>
  );
}
