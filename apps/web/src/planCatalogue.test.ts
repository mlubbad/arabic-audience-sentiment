import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("./data", () => ({
  configuredMode: "live",
  fixtureCatalogue: [],
  adminFixtureCatalogue: [{ key: "fixture-only" }],
}));

import { readAdminCatalogue } from "./planCatalogue";

beforeEach(() => rpc.mockReset());

describe("readAdminCatalogue (live)", () => {
  it("throws on an RPC error instead of returning the fixture plans", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(readAdminCatalogue()).rejects.toThrow("catalogue_unavailable");
  });

  it("refuses a malformed catalogue rather than substituting the fixture", async () => {
    rpc.mockResolvedValue({ data: [{ nope: true }], error: null });
    await expect(readAdminCatalogue()).rejects.toThrow();
  });
});
