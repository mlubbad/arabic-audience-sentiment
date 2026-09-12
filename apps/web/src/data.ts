import { FixtureSchema, snapshot, type Filters } from "@sentiment/contracts";
export const fixtureWorkspace = "00000000-0000-4000-8000-000000000001";

export async function loadSnapshot(filters: Filters, signal: AbortSignal) {
  const response = await fetch("/fixtures/dashboard.json", { signal });
  if (!response.ok) throw new Error("fixture_unavailable");
  const fixture = FixtureSchema.parse(await response.json());
  const build = (f: Filters, cursor_reset: boolean) => ({
    ...snapshot(fixture.comments, f, fixture.active_analysis_key),
    revision: fixture.revision,
    cursor_reset,
  });
  try {
    return build(filters, false);
  } catch (error) {
    if ((error as Error).message !== "invalid_cursor") throw error;
    // The row this cursor pointed at is no longer in the filtered set, so the
    // page it named cannot be rebuilt. Restart from page one and say so, rather
    // than showing an empty page or a page from a different result set.
    return build({ ...filters, cursor: undefined }, true);
  }
}
