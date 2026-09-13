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

/** A page, not JSON: a browser lands here, redirected by Google. */
const page = (status: number, heading: string, detail: string) =>
  new Response(
    `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${heading}</title>` +
      `<body style="font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f6f8;color:#12181f">` +
      `<main style="max-width:34rem;padding:2rem"><h1 style="font-size:1.5rem">${heading}</h1>` +
      `<p style="color:#5a6672;line-height:1.7">${detail}</p></main>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const MESSAGES: Record<string, string> = {
  declined: "لم تُمنح الصلاحية. لم يُربط أي شيء، ويمكنك المحاولة مرة أخرى.",
  no_channel_on_account: "لا توجد قناة يوتيوب على هذا الحساب.",
  ambiguous_channel: "هذا الحساب يملك أكثر من قناة. اختر حسابًا بقناة واحدة.",
  no_refresh_token:
    "لم تمنح Google صلاحية متجددة. أعد المحاولة واقبل الطلب كاملًا.",
  invalid_callback: "الرابط غير مكتمل.",
  connection_revoked: "انتهت صلاحية الربط.",
};

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
    return page(
      200,
      "تم ربط القناة",
      `القناة متصلة الآن (${channelId}). يمكنك إغلاق هذه الصفحة والعودة إلى اللوحة.`,
    );
  } catch (error) {
    const code = (error as Error).message;
    // A known outcome gets its own sentence; anything else gets a code and no
    // detail, because a Google or Postgres error can quote the configuration.
    return page(
      code === "declined" ? 200 : 400,
      code === "declined" ? "لم يكتمل الربط" : "تعذر إتمام الربط",
      MESSAGES[code] ?? `تعذر إتمام الطلب. رمز الخطأ: ${code}`,
    );
  }
});
