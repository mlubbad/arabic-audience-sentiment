/**
 * The rail carries state, not signposts.
 *
 * Two things are true on every screen and used to be findable on one each:
 * which workspace you are in, and whether collection is running. The first
 * was a `<select>` inside the overview and another inside the operations
 * page — one control, written twice, and absent from the account page where
 * a reader with two workspaces most needs to know which one a card belongs
 * to. The second was a panel on the operations page only, so "is anything
 * running?" meant opening the page you visit when something has already gone
 * wrong.
 *
 * Both live here now, once, and read from the same places the pages read:
 * the selection store (with the address, on the pages that own one) and the
 * source entry the overview and the operations page share. The collection
 * line says what the operations page's health panel says, in its words, by
 * reading the same `syncHealth` and the same strings — so a test can assert
 * the two agree, and there is no second wording to drift.
 *
 * Loaded lazily behind the session, like the plan card: none of this exists
 * for a visitor, and the data module it pulls in is not the landing page's.
 */
import { useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useSession, useWorkspaces } from "./session";
import { useWorkspaceSelection } from "./workspaceSelection";
import { useImpersonation } from "./impersonation";
import { workspaceState } from "./workspace";
import { configuredMode, fixtureWorkspace, loadOpsSource } from "./data";
import { syncHealth } from "./syncHealth";
import { useStrings } from "./strings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";

/** The pages that show one workspace, and so own `?ws=` in their address. */
const SCOPED = new Set(["/dashboard", "/sync"]);

export function WorkspaceSwitch() {
  const S = useStrings();
  const { session } = useSession();
  const { isImpersonating, impersonatedUser } = useImpersonation();
  const effectiveUserId = isImpersonating
    ? (impersonatedUser?.id ?? null)
    : (session?.user.id ?? null);
  const { workspaces } = useWorkspaces(session);
  const { pathname } = useLocation();
  const [chosen, setChosen] = useWorkspaceSelection(effectiveUserId, {
    route: SCOPED.has(pathname),
  });
  if (!session || configuredMode !== "live") return null;
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: true,
    workspaces,
    selectedId: chosen,
  });
  if (place.kind !== "ready" && place.kind !== "choose") return null;
  const options = place.options;
  return (
    <div className="app-rail-workspace" data-testid="rail-workspace">
      <p className="app-rail-caption">{S.railWorkspaceCaption}</p>
      {options.length > 1 ? (
        <Select
          value={place.kind === "ready" ? place.id : ""}
          onValueChange={(id) => setChosen(id || null)}
        >
          {/* aria-label moves from the native element to the trigger: it is
              a button, not a form control a wrapping label would associate
              with. The "choose" state is value="" plus a placeholder — Radix
              reserves the empty value for exactly that, and forbids it on an
              item, so there is no placeholder option to render. */}
          <SelectTrigger aria-label={S.changeWorkspace}>
            <SelectValue placeholder={S.choosePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <strong className="app-rail-workspace-name">
          {place.kind === "ready" ? place.name : S.railWorkspaceNone}
        </strong>
      )}
    </div>
  );
}

export function CollectionState() {
  const S = useStrings();
  const { session } = useSession();
  const { isImpersonating, impersonatedUser } = useImpersonation();
  const effectiveUserId = isImpersonating
    ? (impersonatedUser?.id ?? null)
    : (session?.user.id ?? null);
  const { workspaces } = useWorkspaces(session);
  const [chosen] = useWorkspaceSelection(effectiveUserId);
  const place = workspaceState({
    mode: configuredMode,
    fixtureWorkspace,
    signedIn: !!session,
    workspaces,
    selectedId: chosen,
  });
  const workspaceId = place.kind === "ready" ? place.id : null;
  // The rail reads the lightweight ops snapshot: worker health, sync state and quotas,
  // without loading the heavy comment history. Shared with the operations page.
  const source = useQuery({
    queryKey: [
      "ops-source",
      session?.user.id ?? "visitor",
      "live",
      workspaceId,
    ],
    queryFn: ({ signal }) => loadOpsSource("live", workspaceId!, signal),
    enabled: !!session && configuredMode === "live" && !!workspaceId,
  });
  if (!session || configuredMode !== "live" || !workspaceId) return null;
  if (source.isPending)
    return (
      <p className="app-rail-collection" data-testid="rail-collection">
        <span className="app-rail-caption">{S.railCollectionCaption}</span>
        <span data-severity="unknown">{S.railCollectionReading}</span>
      </p>
    );
  if (source.isError)
    return (
      <p className="app-rail-collection" data-testid="rail-collection">
        <span className="app-rail-caption">{S.railCollectionCaption}</span>
        <span data-severity="unknown">{S.railCollectionUnavailable}</span>
      </p>
    );
  const health = syncHealth(source.data.sync ?? null, new Date());
  return (
    <p className="app-rail-collection" data-testid="rail-collection">
      <span className="app-rail-caption">{S.railCollectionCaption}</span>
      {/* The dot is the glance; the sentence beside it is the meaning, and it
          is the operations page's own sentence for this state. */}
      <span data-severity={health.severity} data-key={health.key}>
        <i className="app-rail-dot" aria-hidden="true" />
        {S.syncMessages[health.key]}
      </span>
    </p>
  );
}
