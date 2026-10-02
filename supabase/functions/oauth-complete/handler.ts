import { corsHeaders } from "../_shared/cors.ts";

export interface CompleteDb {
  complete(
    ticket: string,
    nonce: string,
  ): Promise<{
    channel_id: string | null;
    code: string | null;
  }>;
}

export async function handleOauthComplete(
  request: Request,
  db: CompleteDb,
  allowed: string[],
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        ...corsHeaders(request, allowed),
      },
    });
  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });
  if (!request.headers.get("authorization"))
    return json(401, { code: "unauthenticated" });

  let body: { ticket?: unknown; nonce?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { code: "invalid_request" });
  }
  if (
    typeof body.ticket !== "string" ||
    !body.ticket ||
    typeof body.nonce !== "string" ||
    !body.nonce
  )
    return json(403, { code: "oauth_binding_mismatch" });

  const result = await db.complete(body.ticket, body.nonce);
  if (result.code || !result.channel_id)
    return json(403, { code: result.code ?? "oauth_binding_mismatch" });
  return json(200, { channel_id: result.channel_id });
}
