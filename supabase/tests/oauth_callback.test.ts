/**
 * Completing a connection: exchange, identify, seal, attach.
 *
 * Everything a callback carries is a claim made by whoever opened the URL. The
 * tests below are mostly about which of those claims are refused.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ConnectError,
  exchangeCode,
  fetchOwnChannel,
  handleCallback,
  importSealingKey,
  openTokens,
  refreshAccessToken,
  sealTokens,
  type CallbackConfig,
  type CallbackDb,
} from "../functions/_shared/oauth-callback";

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const CHANNEL = `UC${"a".repeat(22)}`;
const config: CallbackConfig = {
  client_id: "1234.apps.googleusercontent.com",
  client_secret: "GOCSPX-not-a-real-secret",
  redirect_uri: "http://127.0.0.1:5173/oauth/youtube/callback",
  token_uri: "https://oauth2.googleapis.com/token",
  key_version: "k1",
};
const binding = {
  user_id: "10000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  client_id: "00000000-0000-4000-8000-0000000000c1",
  code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
};

function transport(
  over: {
    token?: unknown;
    tokenOk?: boolean;
    channels?: unknown;
    channelsOk?: boolean;
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("token"))
      return new Response(
        JSON.stringify(
          over.token ?? {
            access_token: "ya29.access",
            refresh_token: "1//refresh",
            expires_in: 3599,
            scope: "https://www.googleapis.com/auth/youtube.readonly",
          },
        ),
        { status: over.tokenOk === false ? 400 : 200 },
      );
    return new Response(
      JSON.stringify(over.channels ?? { items: [{ id: CHANNEL }] }),
      { status: over.channelsOk === false ? 403 : 200 },
    );
  });
  return { http, calls };
}

function database() {
  const attached: Parameters<CallbackDb["attachChannel"]>[0][] = [];
  const consumed: string[] = [];
  const db: CallbackDb = {
    consumeState: async (hash) => {
      consumed.push(hash);
      if (consumed.length > 1) throw new Error("invalid_state");
      return binding;
    },
    attachChannel: async (input) => {
      attached.push(input);
      return "channel-uuid";
    },
  };
  return { db, attached, consumed };
}

const run = async (over: Parameters<typeof transport>[0] = {}, patch = {}) => {
  const { http, calls } = transport(over);
  const { db, attached, consumed } = database();
  const key = await importSealingKey(KEY_B64);
  const result = await handleCallback({
    code: "4/auth-code",
    state: "state-value",
    error: null,
    config,
    db,
    http,
    key,
    ...patch,
  });
  return { result, calls, attached, consumed, key };
};

describe("completing a YouTube connection", () => {
  it("takes the channel from Google, never from the callback URL", async () => {
    // A callback is reachable by anyone who can guess a URL. If the channel id
    // came from a query parameter, connecting someone else's channel would be
    // a matter of typing it.
    const { result, attached, calls } = await run();
    expect(attached[0].externalChannel).toBe(CHANNEL);
    expect(result.channelId).toBe("channel-uuid");
    const lookup = calls.find((c) => c.url.includes("channels"))!;
    expect(lookup.url).toContain("mine=true");
    expect(lookup.init.headers).toMatchObject({
      authorization: "Bearer ya29.access",
    });
  });

  it("carries the channel's names when Google sends them, and nulls when it does not", async () => {
    const { attached, calls } = await run({
      channels: {
        items: [
          { id: CHANNEL, snippet: { title: "قناة", customUrl: "@qanah" } },
        ],
      },
    });
    expect(calls[1].url).toContain("part=id,snippet");
    expect(attached[0]).toMatchObject({
      externalChannel: CHANNEL,
      handle: "@qanah",
      title: "قناة",
    });
    // No snippet, or one with nothing usable in it, is not a failed connection:
    // the id is the contract and the name is a label on it.
    const bare = await run({ channels: { items: [{ id: CHANNEL }] } });
    expect(bare.attached[0]).toMatchObject({ handle: null, title: null });
    const odd = await run({
      channels: {
        items: [{ id: CHANNEL, snippet: { title: 7, customUrl: " " } }],
      },
    });
    expect(odd.attached[0]).toMatchObject({ handle: null, title: null });
  });

  it("takes the verifier from the stored state, never from the request", async () => {
    // PKCE is worth nothing if the caller supplies both halves of it.
    const { calls } = await run();
    const body = String(calls.find((c) => c.url.includes("token"))!.init.body);
    expect(body).toContain(`code_verifier=${binding.code_verifier}`);
  });

  it("takes the workspace from the stored state, so a callback cannot redirect it", async () => {
    const { attached } = await run();
    expect(attached[0].workspaceId).toBe(binding.workspace_id);
    expect(attached[0].userId).toBe(binding.user_id);
  });

  it("seals the tokens, so a database read is not a working credential", async () => {
    const { attached, key } = await run();
    const sealed = attached[0].sealedTokens;
    const asText = new TextDecoder().decode(sealed);
    expect(asText).not.toContain("ya29.access");
    expect(asText).not.toContain("1//refresh");
    const opened = (await openTokens(key, sealed)) as Record<string, string>;
    expect(opened.access_token).toBe("ya29.access");
    // An absolute expiry, because a stored "3599" tells a later reader nothing.
    expect(Date.parse(opened.expires_at)).toBeGreaterThan(Date.now());
  });

  it("never seals two grants with the same nonce", async () => {
    // AES-GCM reusing a nonce under one key leaks the keystream, and two
    // channels' tokens would unwrap each other.
    const key = await importSealingKey(KEY_B64);
    const a = await sealTokens(key, { t: 1 });
    const b = await sealTokens(key, { t: 1 });
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12));
    expect(await openTokens(key, a)).toEqual({ t: 1 });
  });

  it("refuses a grant that cannot be renewed", async () => {
    // Collection continues long after the browser session. Storing a grant
    // with no refresh token produces a connection that dies within the hour,
    // and looks connected until it does.
    await expect(
      run({ token: { access_token: "ya29.access", expires_in: 3599 } }),
    ).rejects.toThrow("no_refresh_token");
  });

  it("says the user declined, rather than reporting a generic failure", async () => {
    await expect(run({}, { error: "access_denied" })).rejects.toThrow(
      "declined",
    );
    await expect(run({}, { code: null })).rejects.toThrow("invalid_callback");
  });

  it("treats an account with no channel as an answer, not an error to paper over", async () => {
    // A Google account without a YouTube channel authorises perfectly well and
    // owns nothing. Inventing an id would attach the wrong channel.
    await expect(run({ channels: { items: [] } })).rejects.toThrow(
      "no_channel_on_account",
    );
    await expect(
      run({
        channels: { items: [{ id: CHANNEL }, { id: `UC${"b".repeat(22)}` }] },
      }),
    ).rejects.toThrow("ambiguous_channel");
  });

  it("never lets Google's error text out", async () => {
    // A token error body quotes the request back, including the client secret,
    // and a redirect mismatch message carries the whole configuration.
    const { http } = transport({
      tokenOk: false,
      token: { error_description: config.client_secret },
    });
    const { db } = database();
    await expect(
      handleCallback({
        code: "c",
        state: "s",
        error: null,
        config,
        db,
        http,
        key: await importSealingKey(KEY_B64),
      }),
    ).rejects.toThrow(new ConnectError("token_exchange_failed"));
  });

  it("burns the state exactly once, so a replayed callback fails", async () => {
    const { http } = transport();
    const { db, consumed } = database();
    const key = await importSealingKey(KEY_B64);
    const call = () =>
      handleCallback({
        code: "c",
        state: "s",
        error: null,
        config,
        db,
        http,
        key,
      });
    await call();
    await expect(call()).rejects.toThrow();
    expect(consumed).toHaveLength(2);
  });

  it("refuses a sealing key of the wrong length instead of deriving one", async () => {
    await expect(importSealingKey(btoa("short"))).rejects.toThrow(
      "invalid_encryption_key",
    );
  });

  it("exchanges and looks up without any other network call", async () => {
    const { calls } = await run();
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(config.token_uri);
    expect(calls[1].url).toContain("youtube/v3/channels");
  });
});

describe("the pieces on their own", () => {
  it("exchange refuses a non-2xx without reading the body for a reason", async () => {
    const http = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(exchangeCode("c", "v", config, http)).rejects.toThrow(
      "token_exchange_failed",
    );
  });

  it("channel lookup refuses a non-2xx", async () => {
    const http = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(fetchOwnChannel("t", http)).rejects.toThrow(
      "channel_lookup_failed",
    );
  });
});

describe("renewing an access token", () => {
  const http = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("keeps the refresh token Google does not send back", async () => {
    // Google omits refresh_token on a renewal. Writing the response straight
    // over the stored grant erases the only means of renewing again, and the
    // connection works for an hour and is then unrecoverable.
    const result = await refreshAccessToken(
      "1//original",
      config,
      http(200, { access_token: "ya29.new", expires_in: 3599 }),
    );
    expect(result.access_token).toBe("ya29.new");
    expect(result.refresh_token).toBe("1//original");
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());
  });

  it("takes a rotated refresh token when one is sent", async () => {
    const result = await refreshAccessToken(
      "1//original",
      config,
      http(200, {
        access_token: "a",
        refresh_token: "1//rotated",
        expires_in: 60,
      }),
    );
    expect(result.refresh_token).toBe("1//rotated");
  });

  it("treats a revoked grant as over, not as something to retry", async () => {
    // invalid_grant means the user withdrew access or the token lapsed from
    // disuse. Retrying forever would collect nothing while looking connected.
    await expect(
      refreshAccessToken(
        "1//dead",
        config,
        http(400, { error: "invalid_grant" }),
      ),
    ).rejects.toThrow("connection_revoked");
    await expect(
      refreshAccessToken("1//x", config, http(500, { error: "backend" })),
    ).rejects.toThrow("token_refresh_failed");
  });

  it("never returns a renewal without a token in it", async () => {
    await expect(
      refreshAccessToken("1//x", config, http(200, { expires_in: 3599 })),
    ).rejects.toThrow("token_refresh_failed");
  });
});
