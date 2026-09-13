import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("./supabase", () => ({ supabase: { auth: { getSession } } }));

async function load() {
  vi.resetModules();
  return import("./connect");
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  vi.stubGlobal("fetch", vi.fn());
});

describe("starting a connection from the browser", () => {
  it("asks the server for the URL and goes nowhere else", async () => {
    // The browser's whole part. It must not build a Google URL itself: doing so
    // would mean holding the verifier, and PKCE would protect nothing.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ url: "https://accounts.google.com/o/x" }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { beginConnect } = await load();
    const out = await beginConnect("ws-1", "client-1");
    expect(out).toEqual({
      kind: "redirect",
      url: "https://accounts.google.com/o/x",
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      workspace_id: "ws-1",
      client_id: "client-1",
    });
    expect(String(init.body)).not.toContain("verifier");
  });

  it("sends the session, so the server checks membership rather than trusting us", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "https://x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { beginConnect } = await load();
    await beginConnect("ws-1", "client-1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer jwt",
    );
  });

  it("does not call the server at all without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { beginConnect } = await load();
    const out = await beginConnect("ws-1", "client-1");
    expect(out.kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the refusal, so a wrong workspace does not read as a broken server", async () => {
    // These are different problems with different answers: one is "you may
    // not", one is "this workspace has no client", one is "the server is not
    // set up". One message for all three helps nobody.
    for (const [code, fragment] of [
      ["forbidden", "صلاحية"],
      ["invalid_client", "بلا عميل"],
      ["oauth_not_configured", "غير مهيّأ"],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(JSON.stringify({ code }), { status: 403 }),
        ),
      );
      const { beginConnect } = await load();
      const out = await beginConnect("ws-1", "client-1");
      expect(out.kind).toBe("error");
      expect((out as { message: string }).message).toContain(fragment);
    }
  });

  it("shows an unrecognised failure as a code, never as server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "surprise",
              message: "https://proj.co?apikey=secret",
            }),
            { status: 500 },
          ),
      ),
    );
    const { beginConnect } = await load();
    const out = (await beginConnect("ws-1", "client-1")) as { message: string };
    expect(out.message).toContain("surprise");
    expect(out.message).not.toContain("apikey");
  });

  it("survives the service being unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const { beginConnect } = await load();
    expect((await beginConnect("ws-1", "client-1")).kind).toBe("error");
  });
});
