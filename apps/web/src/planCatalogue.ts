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
import { PlanCatalogueSchema } from "@sentiment/contracts";
import { supabase } from "./supabase";
import { configuredMode, fixtureCatalogue } from "./data";

export async function readCatalogue() {
  if (configuredMode !== "live" || !supabase) return fixtureCatalogue;
  const { data, error } = await supabase.rpc("plan_catalogue");
  // The reason is not surfaced: a PostgREST error can carry the request URL.
  if (error) throw new Error("catalogue_unavailable");
  return PlanCatalogueSchema.parse(data);
}

/** `enabled` lets a page that may turn a reader away not ask on their behalf. */
export function usePlanCatalogue(enabled = true) {
  return useQuery({ queryKey: ["catalogue"], queryFn: readCatalogue, enabled });
}

/** Every plan, internal ones included, for the admin page's select. The RPC
 *  refuses a non-admin, so this is only asked once `is_platform_admin()` said yes. */
export async function readAdminCatalogue() {
  if (configuredMode !== "live" || !supabase) return fixtureCatalogue;
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
