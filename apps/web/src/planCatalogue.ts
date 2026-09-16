/**
 * The plan ladder, read once for every surface that shows it.
 *
 * The pricing page lays the catalogue out as cards; the admin page offers its
 * keys in a select. Both read `plan_catalogue()` in live mode and the fixture's
 * six rows otherwise, under one query key, `["catalogue"]`, so the second
 * reader does not refetch what the first already holds.
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
