/**
 * The seam between the Python worker and the SQL control plane.
 *
 * It authenticates a scoped worker credential and translates database
 * refusals into the exact status codes the worker client distinguishes. It
 * never accepts a workspace from the request: which tenant a worker may touch
 * is derived from its credential inside the database, and nothing here can
 * override that.
 *
 * Written as a pure handler with an injected data layer so it is testable
 * without a deployed Supabase project.
 */
export interface WorkerDb {
  /**
   * `jobTypes` scopes the claim to the kinds of work the caller can run —
   * a collection-only run is never handed a topics job to finish half-done.
   * Null or empty means no preference, which is what a worker able to run
   * everything still asks for.
   */
  claim(
    credentialHash: string,
    jobTypes?: string[] | null,
  ): Promise<Record<string, unknown> | null>;
  /**
   * The channel credential for a claimed job, opened and renewed if needed.
   *
   * The worker holds neither the sealing key nor the refresh token, and asks
   * for neither: it receives an access token that expires within the hour. A
   * worker that is compromised loses an hour of read access to one channel,
   * not the ability to renew it indefinitely.
   *
   * Null when the channel has no usable grant — which is a fact about the
   * channel, not a failure to retry.
   */
  accessTokenFor?(
    credentialHash: string,
    jobId: string,
  ): Promise<string | null>;
  heartbeat(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
  ): Promise<void>;
  commitBatch(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    batchKey: string,
    payloadHash: string,
    payload: unknown,
  ): Promise<unknown>;
  finish(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    outcome: string,
    errorCode: string | null,
  ): Promise<void>;
  /** The videos a collect job should read, decided by the server. */
  dueVideos?(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
  ): Promise<unknown>;
  commitCatalogue(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    payload: unknown[],
  ): Promise<unknown>;
  videoFinished(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    videoId: string,
    outcome: string,
    errorCode: string | null,
  ): Promise<void>;
  /**
   * The comment counts a collect run read for one quota unit, before it
   * reads any video. The server defers every selected video whose count has
   * not moved since its last exhausted read and answers with what is still
   * to read. Optional: a gateway without it answers 404 and the worker reads
   * every due video as before.
   */
  videoCounts?(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    payload: unknown,
  ): Promise<unknown>;
  /** The rows an analyse job should classify, under the key the server assigns. */
  topicsDue(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    modelId: string,
    promptVersion: string,
    maxRows: number,
  ): Promise<unknown>;
  commitTopics(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    batchKey: string,
    records: unknown[],
  ): Promise<unknown>;
  /** Enqueue whatever is due for this credential's workspace. No lease. */
  tick(credentialHash: string): Promise<unknown>;
}

/** Refusals the worker client tells apart. Anything else is a 500 with no detail. */
const STATUS: Record<string, number> = {
  invalid_worker_credential: 401,
  forbidden: 403,
  lease_lost: 409,
  batch_conflict: 409,
  quota_exceeded: 429,
  invalid_batch: 400,
  batch_too_large: 400,
  invalid_outcome: 400,
  invalid_catalogue: 400,
  invalid_counts: 400,
  invalid_video: 400,
  invalid_job_type: 400,
  // A workspace with no plan, or one outside its period, is a decision about
  // entitlement — not a fault in this service. These were missing from the
  // map, so metering refused a batch of real predictions and the worker was
  // told "control_plane_error": an operator reading that would go looking for
  // a broken function instead of an unconfigured workspace.
  no_active_plan: 402,
  plan_inactive: 402,
};

/**
 * Resolve a refusal to our own vocabulary.
 *
 * A stand-in throws `{ code: "lease_lost" }`, but a real Postgres driver puts
 * SQLSTATE in `code` and the label in the message, because every raise in the
 * schema names its refusal explicitly. SQLSTATE alone is ambiguous — forbidden
 * and an unknown credential are both 42501 — so the message is what
 * distinguishes them.
 */
function refusalCode(error: unknown): string | undefined {
  const e = error as { code?: string; message?: string };
  if (e?.code && e.code in STATUS) return e.code;
  if (e?.message && e.message in STATUS) return e.message;
  return undefined;
}

const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "content-type": "application/json" },
  });
const refuse = (code: string) => json(STATUS[code] ?? 500, { code });

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const str = (body: Record<string, unknown>, key: string) =>
  typeof body[key] === "string" && (body[key] as string).length > 0
    ? (body[key] as string)
    : null;

export async function handleWorkerRequest(
  request: Request,
  db: WorkerDb,
): Promise<Response> {
  if (request.method !== "POST")
    return json(405, { code: "method_not_allowed" });

  // Checked before anything else, so an unauthenticated caller never reaches
  // the data layer and cannot probe it for timing or error differences.
  const bearer = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!bearer) return refuse("invalid_worker_credential");
  const credential = await sha256Hex(bearer);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse("invalid_batch");
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  try {
    if (path.endsWith("/worker/claim")) {
      // The kinds of work this caller can run, or nothing for no preference.
      // Only well-formed string arrays reach the database; anything else is
      // an unscoped claim rather than an error, because a claim that cannot
      // be parsed is a claim for anything.
      const types =
        Array.isArray(body.types) && body.types.length
          ? body.types.filter((t): t is string => typeof t === "string")
          : null;
      const claimed = await db.claim(credential, types);
      // No work is not a failure, and 204 keeps that unambiguous.
      if (!claimed) return new Response(null, { status: 204 });
      // Normalised on purpose. The data layer returns a jobs row whose key is
      // `id`, but the wire contract should not be whatever columns that table
      // happens to have, and the worker has no use for the rest of them.
      // Fetched here rather than by the worker, because reaching the sealed
      // grant needs the service role and the worker has neither that nor the
      // key. A channel with no usable grant still returns the job: the worker
      // can report it as blocked, which is more useful than a silent refusal.
      const accessToken = db.accessTokenFor
        ? await db.accessTokenFor(credential, String(claimed.id))
        : null;
      const type = String(claimed.type ?? "collect");
      const videos =
        type === "collect" && db.dueVideos
          ? await db.dueVideos(
              credential,
              String(claimed.id),
              String(claimed.lease_token),
            )
          : [];
      return json(200, {
        job_id: claimed.id,
        lease_token: claimed.lease_token,
        checkpoint: claimed.checkpoint ?? null,
        access_token: accessToken,
        type,
        videos,
      });
    }

    if (path.endsWith("/worker/tick"))
      return json(200, await db.tick(credential));

    // Route first: an unknown path is 404 whatever the body looks like, so a
    // typo is never reported as a malformed request.
    const leased = [
      "/worker/heartbeat",
      "/worker/commit-batch",
      "/worker/finish",
      "/worker/commit-catalogue",
      "/worker/video-finished",
      ...(db.videoCounts ? ["/worker/video-counts"] : []),
      "/worker/topics-due",
      "/worker/commit-topics",
    ];
    if (!leased.some((route) => path.endsWith(route)))
      return json(404, { code: "not_found" });

    const job = str(body, "job_id");
    const lease = str(body, "lease_token");
    if (!job || !lease) return refuse("invalid_batch");

    if (path.endsWith("/worker/heartbeat")) {
      await db.heartbeat(credential, job, lease);
      return json(200, {});
    }
    if (path.endsWith("/worker/commit-batch")) {
      const key = str(body, "batch_key");
      const hash = str(body, "payload_hash");
      if (
        !key ||
        !hash ||
        !/^[0-9a-f]{64}$/.test(hash) ||
        typeof body.payload !== "object"
      )
        return refuse("invalid_batch");
      // Only these five reach the database. A workspace_id in the request body
      // is simply never read, so a worker cannot address another tenant.
      return json(
        200,
        await db.commitBatch(credential, job, lease, key, hash, body.payload),
      );
    }
    if (path.endsWith("/worker/finish")) {
      const outcome = str(body, "outcome");
      if (!outcome) return refuse("invalid_batch");
      await db.finish(credential, job, lease, outcome, str(body, "error_code"));
      return json(200, {});
    }
    if (path.endsWith("/worker/commit-catalogue")) {
      if (!Array.isArray(body.payload)) return refuse("invalid_catalogue");
      return json(
        200,
        await db.commitCatalogue(credential, job, lease, body.payload),
      );
    }
    if (path.endsWith("/worker/video-finished")) {
      const video = str(body, "video_id");
      const outcome = str(body, "outcome");
      if (!video || !outcome) return refuse("invalid_batch");
      await db.videoFinished(
        credential,
        job,
        lease,
        video,
        outcome,
        str(body, "error_code"),
      );
      return json(200, {});
    }
    if (path.endsWith("/worker/video-counts") && db.videoCounts) {
      // An array is the only shape the handler can judge; the items are the
      // database's to refuse, whole, as invalid_counts.
      if (!Array.isArray(body.payload)) return refuse("invalid_counts");
      return json(
        200,
        await db.videoCounts(credential, job, lease, body.payload),
      );
    }
    if (path.endsWith("/worker/topics-due")) {
      const model = str(body, "model_id");
      const prompt = str(body, "prompt_version");
      // Absent means the default; present means a positive integer. A zero,
      // a fraction or a string would otherwise reach the database as a
      // number it clamps to 1 — a request that was wrong, answered anyway.
      const max = body.max_rows === undefined ? 200 : body.max_rows;
      if (!model || !prompt) return refuse("invalid_batch");
      if (typeof max !== "number" || !Number.isInteger(max) || max < 1)
        return refuse("invalid_batch");
      return json(
        200,
        await db.topicsDue(credential, job, lease, model, prompt, max),
      );
    }
    if (path.endsWith("/worker/commit-topics")) {
      const key = str(body, "batch_key");
      if (!key || !Array.isArray(body.records)) return refuse("invalid_batch");
      return json(
        200,
        await db.commitTopics(credential, job, lease, key, body.records),
      );
    }
    return json(404, { code: "not_found" });
  } catch (error) {
    const code = refusalCode(error);
    if (code) return refuse(code);
    // The message is still withheld — a driver error can carry the connection
    // string, and a credential with it. The SQLSTATE is not the message: five
    // characters that name the class of failure and can hold no secret. It was
    // being discarded along with the message, which left an operator with a
    // rejected batch and the word "error", and no way to tell a constraint
    // violation from a missing function.
    const sqlstate = (error as { code?: string } | null)?.code;
    const named =
      typeof sqlstate === "string" && /^[0-9A-Z]{5}$/.test(sqlstate)
        ? `control_plane_error:${sqlstate}`
        : "control_plane_error";
    return json(500, { code: named });
  }
}
