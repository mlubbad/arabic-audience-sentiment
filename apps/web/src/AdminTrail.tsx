/**
 * «القنوات ‹ name», with the previous and next channel, above a workspace's
 * own pages when the owner entered it from the channels console
 * (`admin/adminTrail.ts`). Only a platform admin, not while impersonating,
 * and only on the pages that show one workspace; a page outside the trail
 * shows nothing. The links change `?ws=` and keep the page and everything
 * else in the address, so the owner moves along the list on the same page.
 */
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useSession } from "./session";
import { useIsPlatformAdmin } from "./adminAccess";
import { useImpersonation } from "./impersonation";
import { useStrings } from "./strings";
import { workspaceFromSearch, searchWithWorkspace } from "./workspaceUrl";
import { clearTrail, readTrail, trailStep } from "./admin/adminTrail";

/** The pages that show one workspace (as `RailState.tsx` lists them). */
const SCOPED = new Set(["/dashboard", "/sync"]);

export function AdminTrail() {
  const S = useStrings();
  const { pathname, search } = useLocation();
  const { session } = useSession();
  const { isImpersonating } = useImpersonation();
  const admin = useIsPlatformAdmin(session);
  const [closed, setClosed] = useState(false);

  if (closed || isImpersonating || admin.data !== true || !SCOPED.has(pathname))
    return null;
  const step = trailStep(readTrail(), workspaceFromSearch(search));
  if (!step) return null;

  const to = (ws: string) =>
    `${pathname}?${searchWithWorkspace(search, ws).toString()}`;

  return (
    <nav
      className="app-admin-trail"
      aria-label={S.adminTrailLabel}
      data-testid="admin-trail"
    >
      <Link to={step.back}>{S.adminTabChannels}</Link>
      <span aria-hidden="true">‹</span>
      <strong dir="auto">{step.name}</strong>
      <span className="app-admin-trail-pos">
        {S.adminConsolePosition(step.position, step.count)}
      </span>
      <span className="app-admin-trail-moves">
        {step.prev ? (
          <Link
            to={to(step.prev.workspace_id)}
            aria-label={`${S.adminConsolePrev}: ${step.prev.name}`}
          >
            {S.adminConsolePrev}
          </Link>
        ) : (
          <span aria-disabled="true">{S.adminConsolePrev}</span>
        )}
        {step.next ? (
          <Link
            to={to(step.next.workspace_id)}
            aria-label={`${S.adminConsoleNext}: ${step.next.name}`}
          >
            {S.adminConsoleNext}
          </Link>
        ) : (
          <span aria-disabled="true">{S.adminConsoleNext}</span>
        )}
        <button
          type="button"
          className="app-admin-trail-close"
          onClick={() => {
            clearTrail();
            setClosed(true);
          }}
          aria-label={S.adminTrailClose}
        >
          ✕
        </button>
      </span>
    </nav>
  );
}
