/**
 * Begins a connection. Runs as the signed-in user, not as the service.
 *
 * The workspace is checked by public.oauth_start against that user's own
 * membership, so a caller asking to start a connection in someone else's
 * workspace is refused by the database rather than by anything here.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { beginAuthorization } from "../_shared/oauth-start.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });
  const auth = request.headers.get("authorization");
  if (!auth) return json(401, { code: "unauthenticated" });

  let body: { workspace_id?: string; client_id?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (!body.workspace_id || !body.client_id)
    return json(400, { code: "invalid_request" });

  // The caller's own token, so RLS and the role check apply to them.
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });

  try {
    const { url } = await beginAuthorization(
      body.workspace_id,
      body.client_id,
      {
        client_id: env("GOOGLE_CLIENT_ID"),
        redirect_uri: env("GOOGLE_REDIRECT_URI"),
        scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      },
      {
        createState: async (w, c, stateHash, verifier) => {
          const { error } = await db.rpc("oauth_start", {
            w,
            c,
            state_hash: stateHash,
            verifier,
          });
          if (error) throw new Error(error.code ?? "forbidden");
        },
      },
      (n) => crypto.getRandomValues(new Uint8Array(n)),
    );
    // The URL only. The verifier stays on this side; the state is in it.
    return json(200, { url });
  } catch (error) {
    const code = (error as Error).message;
    return json(code === "oauth_not_configured" ? 500 : 403, { code });
  }
});
