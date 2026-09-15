/**
 * Finishes a connection. Runs as the service, because it reads a single-use
 * state row and writes sealed tokens — neither of which any tenant may touch.
 *
 * Nothing it accepts from the browser decides which workspace is affected: the
 * binding comes from the state row, and the channel from channels.list.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { handleCallback, importSealingKey } from "../_shared/oauth-callback.ts";

const env = (name: string) => Deno.env.get(name) ?? "";

/**
 * The callback hands the browser back to the app rather than rendering a page.
 *
 * Two reasons. Supabase rewrites a function's content-type to text/plain with
 * nosniff — it will not serve HTML from its own domain — so the Arabic page this
 * used to return arrived as mojibake. And landing someone on a supabase.co URL
 * at the end of connecting their channel strands them outside the product; the
 * result belongs in the product, in its own design.
 *
 * The outcome travels as a code, never as a message. A code is an enum the app
 * translates; a message could carry a Google error body, and those quote the
 * request back.
 */
const back = (params: Record<string, string>) =>
  new Response(null, {
    status: 303,
    headers: {
      location: `${env("APP_ORIGIN") || "https://app.sky-develop.net"}/connected?${new URLSearchParams(params)}`,
    },
  });

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const db = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
  );

  try {
    const { channelId } = await handleCallback({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
      config: {
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: env("GOOGLE_REDIRECT_URI"),
        token_uri: "https://oauth2.googleapis.com/token",
        key_version: env("TOKEN_ENCRYPTION_KEY_VERSION") || "k1",
      },
      db: {
        consumeState: async (hash) => {
          const { data, error } = await db.rpc("svc_oauth_consume_state", {
            state_hash: hash,
          });
          if (error || !data?.length) throw new Error("invalid_state");
          return data[0];
        },
        attachChannel: async (input) => {
          const { data, error } = await db.rpc("svc_oauth_attach_channel", {
            u: input.userId,
            w: input.workspaceId,
            c: input.clientId,
            external_channel: input.externalChannel,
            channel_handle: input.handle,
            channel_title: input.title,
            // bytea over PostgREST travels as a hex literal.
            tokens:
              "\\x" +
              [...input.sealedTokens]
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(""),
            key_version: input.keyVersion,
            scopes: input.scopes,
          });
          if (error) throw new Error(error.code ?? "attach_failed");
          return data as string;
        },
      },
      http: (u, init) => fetch(u, init),
      key: await importSealingKey(env("TOKEN_ENCRYPTION_KEY")),
    });
    return back({ status: "connected", channel: channelId });
  } catch (error) {
    return back({ status: "error", code: (error as Error).message });
  }
});
