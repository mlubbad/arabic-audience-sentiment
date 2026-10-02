import { describe, expect, it, vi } from "vitest";
import { handleOauthComplete } from "../functions/oauth-complete/handler";

const request = (body: unknown, auth = "Bearer jwt") =>
  new Request("https://project.test/functions/v1/oauth-complete", {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
      origin: "https://app.example",
    },
    body: JSON.stringify(body),
  });

describe("oauth-complete edge handler", () => {
  it("passes only the ticket and nonce to the single SQL call", async () => {
    const complete = vi.fn(async () => ({
      channel_id: "channel-id",
      code: null,
    }));
    const response = await handleOauthComplete(
      request({ ticket: "ticket", nonce: "nonce", workspace_id: "forged" }),
      { complete },
      ["https://app.example"],
    );
    expect(response.status).toBe(200);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith("ticket", "nonce");
    expect(await response.json()).toEqual({ channel_id: "channel-id" });
  });

  it("returns the stable binding refusal without exposing database text", async () => {
    const response = await handleOauthComplete(
      request({ ticket: "ticket", nonce: "wrong" }),
      {
        complete: async () => ({
          channel_id: null,
          code: "oauth_binding_mismatch",
        }),
      },
      ["https://app.example"],
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "oauth_binding_mismatch" });
  });

  it.each([
    ["23505", 409, "channel_already_connected"],
    ["database_unavailable", 500, "oauth_complete_failed"],
  ])(
    "maps rejected completion RPCs to a CORS-enabled response",
    async (rpcCode, status, responseCode) => {
      const response = await handleOauthComplete(
        request({ ticket: "ticket", nonce: "nonce" }),
        {
          complete: async () => {
            throw new Error(rpcCode);
          },
        },
        ["https://app.example"],
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://app.example",
      );
      expect(await response.json()).toEqual({ code: responseCode });
    },
  );

  it("refuses missing authentication and missing binding inputs", async () => {
    const complete = vi.fn();
    expect(
      (
        await handleOauthComplete(
          request({ ticket: "t", nonce: "n" }, ""),
          { complete },
          [],
        )
      ).status,
    ).toBe(401);
    expect(
      (await handleOauthComplete(request({ ticket: "t" }), { complete }, []))
        .status,
    ).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });
});
