import { FixtureSchema, snapshot, type Filters } from "@sentiment/contracts";
export const fixtureWorkspace = "00000000-0000-4000-8000-000000000001";
export async function loadSnapshot(filters: Filters, signal: AbortSignal) {
  const response = await fetch("/fixtures/dashboard.json", { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  const fixture = FixtureSchema.parse(await response.json());
  return {
    ...snapshot(fixture.comments, filters, fixture.active_analysis_key),
    revision: fixture.revision,
  };
}
