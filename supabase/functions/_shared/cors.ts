/**
 * Cross-origin headers for the one function a browser calls directly.
 *
 * Without these the browser refuses the request before sending it, and the app
 * sees a generic network failure with nothing to diagnose. Every curl test
 * passed throughout, because curl does not enforce CORS — which is precisely
 * why "verified with curl" was not the same as "works in a browser".
 *
 * An allowlist rather than `*`. The functions are reached with a user's access
 * token in an Authorization header, so a permissive origin would let any page
 * on the internet start a connection using a token it had obtained; narrowing
 * it costs nothing and closes that off. An unknown origin gets no
 * allow-origin header, so the browser refuses it — which is the correct answer
 * rather than an error we have to invent.
 */
/**
 * The allowlist is passed in, not read from the environment here. Everything in
 * _shared is runtime-agnostic and typechecked by the Node compiler; reaching for
 * Deno.env in it broke that and the build caught it. Reading configuration is
 * the entry point's job, which is also what makes this testable.
 */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

const DEFAULT_ALLOWED_HEADERS =
  "authorization, content-type, apikey, x-client-info, x-retry-count, traceparent, tracestate, baggage";

export function corsHeaders(
  request: Request,
  allowed: string[],
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return {};
  const requestedHeaders = request.headers.get(
    "access-control-request-headers",
  );
  return {
    "access-control-allow-origin": origin,
    // Echoing the origin means the response differs per origin, so a cache
    // must not serve one origin's response to another.
    vary: "Origin",
    "access-control-allow-headers": requestedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "600",
  };
}

/** Answers the browser's preflight, or null when this is not one. */
export function preflight(
  request: Request,
  allowed: string[],
): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, allowed),
  });
}
