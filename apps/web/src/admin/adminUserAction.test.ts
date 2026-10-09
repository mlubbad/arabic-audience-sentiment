import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  current: { access_token: "token-1" } as { access_token: string } | null,
}));
vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: session.current } }),
    },
  },
}));

import { AdminUserActionError, adminUserAction } from "./adminRead";

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => (e instanceof AdminUserActionError ? e.code : `other:${e}`),
  );

beforeEach(() => {
  session.current = { access_token: "token-1" };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("adminUserAction", () => {
  it("posts the action with the caller's own token and answers what the function did", async () => {
    answer(200, { ok: true, recorded: true, link: "https://x/verify" });
    expect(await adminUserAction("recovery_link", "u1")).toEqual({
      recorded: true,
      link: "https://x/verify",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/functions\/v1\/admin-users$/);
    expect(init.headers.authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({
      action: "recovery_link",
      user_id: "u1",
    });
  });

  it("says when the action happened but was not recorded", async () => {
    answer(200, { ok: true, recorded: false });
    expect(await adminUserAction("suspend", "u1")).toEqual({
      recorded: false,
      link: undefined,
    });
  });

  it("names the function's own refusals", async () => {
    answer(409, { code: "email_taken" });
    expect(await code(adminUserAction("change_email", "u1", "a@b.co"))).toBe(
      "email_taken",
    );
    answer(404, { code: "user_not_found" });
    expect(await code(adminUserAction("suspend", "u1"))).toBe("user_not_found");
  });

  it("reads a gateway 404 as the function not deployed yet", async () => {
    answer(404, {
      code: "NOT_FOUND",
      message: "Requested function was not found",
    });
    expect(await code(adminUserAction("suspend", "u1"))).toBe("not_deployed");
  });

  it("collapses anything else, and a dead network, to unavailable", async () => {
    answer(500, { message: "boom" });
    expect(await code(adminUserAction("suspend", "u1"))).toBe("unavailable");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await code(adminUserAction("suspend", "u1"))).toBe("unavailable");
  });

  it("asks nothing without a session", async () => {
    session.current = null;
    expect(await code(adminUserAction("suspend", "u1"))).toBe("forbidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
