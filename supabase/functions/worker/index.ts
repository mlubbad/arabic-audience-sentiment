/**
 * The worker gateway. Service role, because the worker's own credential is
 * scoped and the primitives it calls are not tenant-callable.
 *
 * The workspace is never read from the request: it is derived inside the
 * database from the hashed bearer this handler passes in.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { handleWorkerRequest } from "../_shared/worker-gateway.ts";
import {
  importSealingKey,
  openTokens,
  refreshAccessToken,
  RevokedError,
} from "../_shared/oauth-callback.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const failed = (error: unknown): never => {
  // Postgres puts its own label in the message; the handler reads either.
  throw Object.assign(
    new Error((error as { message?: string })?.message ?? ""),
    {
      code: (error as { code?: string })?.code,
    },
  );
};

/**
 * Opens the channel grant for a claimed job and returns a usable access token.
 *
 * Renewed here rather than by the worker, and written back, so the next claim
 * does not renew again. A grant Google has revoked marks the channel for
 * reconnection instead of being retried: nothing on the worker's side can fix
 * a withdrawn authorisation, and retrying it would collect nothing while the
 * channel looked connected.
 */
async function accessTokenFor(
  credentialHash: string,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("svc_worker_channel_grant", {
    credential_hash: credentialHash,
    j: jobId,
  });
  // No grant is a fact about the channel, not a failure to retry.
  if (error || !data?.length) return null;

  const grant = data[0] as { connection_id: string; encrypted_tokens: string };
  const key = await importSealingKey(env("TOKEN_ENCRYPTION_KEY"));
  // bytea arrives from PostgREST as a \x-prefixed hex literal.
  const hex = grant.encrypted_tokens.replace(/^\\x/, "");
  const sealed = new Uint8Array(
    hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [],
  );
  const tokens = (await openTokens(key, sealed)) as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };

  // A minute of margin: a token that expires mid-collection costs a whole run.
  if (Date.parse(tokens.expires_at) - Date.now() > 60_000)
    return tokens.access_token;

  try {
    const renewed = await refreshAccessToken(
      tokens.refresh_token,
      {
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: env("GOOGLE_REDIRECT_URI"),
        token_uri: "https://oauth2.googleapis.com/token",
        key_version: env("TOKEN_ENCRYPTION_KEY_VERSION") || "k1",
      },
      (u, init) => fetch(u, init),
    );
    const { sealTokens } = await import("../_shared/oauth-callback.ts");
    const resealed = await sealTokens(key, renewed);
    await db.rpc("svc_worker_store_grant", {
      credential_hash: credentialHash,
      connection: grant.connection_id,
      tokens:
        "\\x" +
        [...resealed].map((b) => b.toString(16).padStart(2, "0")).join(""),
    });
    return renewed.access_token;
  } catch (e) {
    if (e instanceof RevokedError)
      await db.rpc("svc_worker_mark_revoked", {
        credential_hash: credentialHash,
        j: jobId,
      });
    return null;
  }
}

Deno.serve((request) =>
  handleWorkerRequest(request, {
    accessTokenFor,
    claim: async (hash) => {
      const { data, error } = await db.rpc("svc_worker_claim", {
        credential_hash: hash,
      });
      if (error) failed(error);
      return data?.[0] ?? null;
    },
    heartbeat: async (hash, j, t) => {
      const { error } = await db.rpc("svc_worker_heartbeat", {
        credential_hash: hash,
        j,
        t,
      });
      if (error) failed(error);
    },
    commitBatch: async (hash, j, t, b, payloadHash, payload) => {
      const { data, error } = await db.rpc("svc_worker_commit_batch", {
        credential_hash: hash,
        j,
        t,
        b,
        hash: payloadHash,
        payload,
      });
      if (error) failed(error);
      return data;
    },
    finish: async (hash, j, t, outcome, errorCode) => {
      const { error } = await db.rpc("svc_worker_finish", {
        credential_hash: hash,
        j,
        t,
        outcome,
        error_code: errorCode,
      });
      if (error) failed(error);
    },
    dueVideos: async (hash, j, t) => {
      const { data, error } = await db.rpc("svc_worker_due_videos", {
        credential_hash: hash,
        j,
        t,
      });
      if (error) failed(error);
      return data ?? [];
    },
    commitCatalogue: async (hash, j, t, payload) => {
      const { data, error } = await db.rpc("svc_worker_commit_catalogue", {
        credential_hash: hash,
        j,
        t,
        payload,
      });
      if (error) failed(error);
      return data;
    },
    videoFinished: async (hash, j, t, v, outcome, errorCode) => {
      const { error } = await db.rpc("svc_worker_video_finished", {
        credential_hash: hash,
        j,
        t,
        v,
        outcome,
        error_code: errorCode,
      });
      if (error) failed(error);
    },
    topicsDue: async (hash, j, t, modelId, promptVersion, maxRows) => {
      const { data, error } = await db.rpc("svc_worker_topics_due", {
        credential_hash: hash,
        j,
        t,
        model_id: modelId,
        prompt_version: promptVersion,
        max_rows: maxRows,
      });
      if (error) failed(error);
      return data;
    },
    commitTopics: async (hash, j, t, b, records) => {
      const { data, error } = await db.rpc("svc_worker_commit_topics", {
        credential_hash: hash,
        j,
        t,
        b,
        records,
      });
      if (error) failed(error);
      return data;
    },
    tick: async (hash) => {
      const { data, error } = await db.rpc("svc_worker_tick", {
        credential_hash: hash,
      });
      if (error) failed(error);
      return data;
    },
  }),
);
