import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { parseOrigins, preflight } from "../_shared/cors.ts";
import { handleOauthComplete } from "./handler.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const allowed = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

Deno.serve(async (request) => {
  const pre = preflight(request, allowed);
  if (pre) return pre;
  const auth = request.headers.get("authorization") ?? "";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: auth } },
  });
  return handleOauthComplete(
    request,
    {
      complete: async (ticket, nonce, choice) => {
        const { data, error } = await db.rpc(
          "oauth_complete",
          choice ? { ticket, nonce, choice } : { ticket, nonce },
        );
        if (error) throw new Error(error.code ?? "oauth_complete_failed");
        return (
          data?.[0] ?? {
            channel_id: null,
            code: "oauth_binding_mismatch",
          }
        );
      },
    },
    allowed,
  );
});
