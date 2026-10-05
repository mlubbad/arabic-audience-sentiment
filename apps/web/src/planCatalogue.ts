/**
 * The plan ladder, read once for every surface that shows it.
 *
 * The pricing page lays the catalogue out as cards and reads `plan_catalogue()`
 * in live mode, the fixture's six rows otherwise, under one query key,
 * `["catalogue"]`. The admin page needs the internal plans too, so it reads
 * `admin_plan_catalogue()` — the same shape, every row, admins only — under
 * its own key.
 */
import { useQuery } from "@tanstack/react-query";
import { PlanCatalogueSchema, type Plan } from "@sentiment/contracts";
import { supabase } from "./supabase";
import {
  configuredMode,
  fixtureCatalogue,
  adminFixtureCatalogue,
} from "./data";

/** Where a prerendered pricing page carries the rows it was rendered with.
 *  `scripts/prerender.mjs` writes them as `<script type="application/json">`
 *  under this id, and the first read below takes them as the query's initial
 *  data — so the hydrated page shows the cards the static HTML showed, with
 *  no "reading the plans…" between, and then asks the server for the current
 *  rows as it always did. Marked stale from the start (`initialDataUpdatedAt:
 *  0`), so that refetch is not skipped. */
export const EMBEDDED_CATALOGUE_ID = "plan-catalogue";

export function embeddedCatalogue(): Plan[] | undefined {
  const text = globalThis.document?.getElementById(
    EMBEDDED_CATALOGUE_ID,
  )?.textContent;
  if (!text) return undefined;
  try {
    return PlanCatalogueSchema.parse(JSON.parse(text));
  } catch {
    // Not the catalogue: the page renders as if nothing was embedded.
    return undefined;
  }
}

export async function readCatalogue() {
  if (configuredMode !== "live" || !supabase) return fixtureCatalogue;
  const { data, error } = await supabase.rpc("plan_catalogue");
  // The reason is not surfaced: a PostgREST error can carry the request URL.
  if (error) throw new Error("catalogue_unavailable");
  return PlanCatalogueSchema.parse(data);
}

/** `enabled` lets a page that may turn a reader away not ask on their behalf. */
export function usePlanCatalogue(enabled = true) {
  return useQuery({
    queryKey: ["catalogue"],
    queryFn: readCatalogue,
    enabled,
    initialData: embeddedCatalogue,
    initialDataUpdatedAt: 0,
  });
}

/** Every plan, internal ones included, for the admin page's select. The RPC
 *  refuses a non-admin, so this is only asked once `is_platform_admin()` said yes. */
export async function readAdminCatalogue() {
  if (configuredMode !== "live" || !supabase) return adminFixtureCatalogue;
  // Live mode never falls back to the fixture: an admin editing plan limits
  // against fixture rows would be editing plans that do not exist. A failed
  // read is shown as one (AdminPlansPage renders the error state).
  const { data, error } = await supabase.rpc("admin_plan_catalogue");
  if (error) throw new Error("catalogue_unavailable");
  return PlanCatalogueSchema.parse(data);
}

export function useAdminPlanCatalogue(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "catalogue"],
    queryFn: readAdminCatalogue,
    enabled,
  });
}
