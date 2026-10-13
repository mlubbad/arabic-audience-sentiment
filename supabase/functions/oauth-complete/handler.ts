import { corsHeaders } from "../_shared/cors.ts";

export interface CompleteDb {
  complete(
    ticket: string,
    nonce: string,
    choice?: string,
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

  let body: { ticket?: unknown; nonce?: unknown; choice?: unknown };
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

  // A chosen page (several pages under one ticket) is a row id; anything
  // else is refused before the database is asked.
  const choice = body.choice;
  if (
    choice !== undefined &&
    (typeof choice !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        choice,
      ))
  )
    return json(400, { code: "invalid_choice" });

  let result: Awaited<ReturnType<CompleteDb["complete"]>>;
  try {
    result =
      choice === undefined
        ? await db.complete(body.ticket, body.nonce)
        : await db.complete(body.ticket, body.nonce, choice);
  } catch (error) {
    const rpcCode = error instanceof Error ? error.message : "";
    return rpcCode === "23505"
      ? json(409, { code: "channel_already_connected" })
      : json(500, { code: "oauth_complete_failed" });
  }
  // Not a refusal: the ticket holds several pages and waits for a choice.
  if (result.code === "choose_page" || result.code === "invalid_choice")
    return json(409, { code: result.code });
  if (result.code || !result.channel_id)
    return json(403, { code: result.code ?? "oauth_binding_mismatch" });
  return json(200, { channel_id: result.channel_id });
}
