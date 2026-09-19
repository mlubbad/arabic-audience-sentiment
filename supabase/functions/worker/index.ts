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
 * How soon before expiry a token is considered stale.
 *
 * A collection run can last longer than the hour its token starts with, and
 * a token that lapses mid-run costs the whole run. Renewing whenever less
 * than a quarter of an hour remains keeps the renewal at claim time for the
 * ordinary job, and leaves the mid-run renewal as a backstop for the long
 * ones rather than the normal way a run survives.
 */
const RENEW_MARGIN_MS = 15 * 60_000;

/**
 * Opens the channel grant and returns a usable access token, renewing and
 * writing back when the stored one is near its end, so the next request does
 * not renew again.
 *
 * A grant Google has revoked marks the channel for reconnection instead of
 * being retried: nothing on the worker's side can fix a withdrawn
 * authorisation, and retrying it would collect nothing while the channel
 * looked connected.
 */
async function issueToken(
  credentialHash: string,
  grant: { connection_id: string; encrypted_tokens: string; job_id: string },
  kind: "channel" | "reader" = "channel",
): Promise<{
  access_token: string;
  access_token_expires_at: string;
} | null> {
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

  if (Date.parse(tokens.expires_at) - Date.now() > RENEW_MARGIN_MS)
    return {
      access_token: tokens.access_token,
      access_token_expires_at: tokens.expires_at,
    };

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
    const hexToken =
      "\\x" +
      [...resealed].map((b) => b.toString(16).padStart(2, "0")).join("");
    // The reader's renewal is written back to the reader's own row, never to
    // the connection its seal was copied from.
    await db.rpc(
      kind === "reader"
        ? "svc_worker_store_reader_grant"
        : "svc_worker_store_grant",
      {
        credential_hash: credentialHash,
        connection: grant.connection_id,
        tokens: hexToken,
      },
    );
    return {
      access_token: renewed.access_token,
      access_token_expires_at: renewed.expires_at,
    };
  } catch (e) {
    if (e instanceof RevokedError) {
      if (kind === "reader")
        await db.rpc("svc_worker_reader_revoked", {
          credential_hash: credentialHash,
          connection: grant.connection_id,
        });
      else
        await db.rpc("svc_worker_mark_revoked", {
          credential_hash: credentialHash,
          j: grant.job_id,
        });
    }
    return null;
  }
}

async function accessTokenFor(
  credentialHash: string,
  jobId: string,
): Promise<{ access_token: string; access_token_expires_at: string } | null> {
  const { data, error } = await db.rpc("svc_worker_channel_grant", {
    credential_hash: credentialHash,
    j: jobId,
  });
  // No grant is a fact about the channel, not a failure to retry.
  if (error || !data?.length) return null;
  const grant = data[0] as { connection_id: string; encrypted_tokens: string };
  return issueToken(credentialHash, { ...grant, job_id: jobId });
}

/**
 * The platform reader's token, for a public channel whose job has no grant of
 * its own. Any valid worker credential may ask: every tenant's public jobs
 * are collected with this one grant. Null when no active reader — the claim
 * then answers with the channel's id alone, and a key-carrying worker (or
 * none) takes it from there.
 */
async function readerTokenFor(
  credentialHash: string,
): Promise<{ access_token: string; access_token_expires_at: string } | null> {
  const { data, error } = await db.rpc("svc_worker_reader_grant", {
    credential_hash: credentialHash,
  });
  if (error || !data?.length) return null;
  const grant = data[0] as { connection_id: string; encrypted_tokens: string };
  return issueToken(credentialHash, { ...grant, job_id: "" }, "reader");
}

/**
 * A fresh token for a run in progress, against a lease the worker still holds.
 *
 * The lease is validated in the database by the same private seam as every
 * other leased call, so a worker that lost its lease is refused here rather
 * than minted tokens for a job someone else holds. Null means the channel's
 * grant is gone; the worker stops asking and the retry path reports it.
 */
async function renewToken(
  credentialHash: string,
  jobId: string,
  leaseToken: string,
): Promise<{ access_token: string; access_token_expires_at: string } | null> {
  const { data, error } = await db.rpc("svc_worker_renew_grant", {
    credential_hash: credentialHash,
    j: jobId,
    t: leaseToken,
  });
  // A channel whose grant vanished mid-run answers the same thing the claim
  // path does — no token — rather than a 500 the worker would have to guess
  // at. A lost lease is left to travel as its own refusal: the run ends.
  if (error) {
    if ((error as { message?: string }).message === "channel_not_connected")
      return null;
    failed(error);
  }
  if (data?.length) {
    const grant = data[0] as {
      connection_id: string;
      encrypted_tokens: string;
    };
    return issueToken(credentialHash, { ...grant, job_id: jobId });
  }
  // A public job has no channel grant to renew; its run renews the platform
  // reader instead, but only when the job's channel really is public — the
  // reader is never handed to a connected channel's run.
  const { data: job } = await db
    .from("jobs")
    .select("channel_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.channel_id) return null;
  const { data: channel } = await db
    .from("channels")
    .select("status")
    .eq("id", job.channel_id)
    .maybeSingle();
  if (channel?.status !== "public_unverified") return null;
  return readerTokenFor(credentialHash);
}

Deno.serve((request) =>
  handleWorkerRequest(request, {
    accessTokenFor,
    readerTokenFor,
    renewToken,
    claim: async (hash, jobTypes) => {
      // A null/empty list calls the single-argument RPC: an unscoped claim.
      const rpcArgs =
        jobTypes && jobTypes.length
          ? { credential_hash: hash, job_types: jobTypes }
          : { credential_hash: hash };
      const { data, error } = await db.rpc("svc_worker_claim", rpcArgs);
      if (error) failed(error);
      const claimed = data?.[0] ?? null;
      if (!claimed) return null;
      // A public channel has no grant to open, and until now that made it
      // uncollectable: the worker saw no token and no identity, and could
      // only report the job blocked. When the claimed job's channel is
      // registered as public data, its platform id travels with the lease so
      // the worker can read the public catalogue and comments by id. A
      // connected channel's id deliberately does not travel — a grant that
      // failed to open is the worker's signal to report the channel
      // unconnected, not an invitation to fall back to public collection
      // without anyone deciding that.
      if (claimed.channel_id) {
        const { data: channel } = await db
          .from("channels")
          .select("external_channel_id,status")
          .eq("id", claimed.channel_id)
          .maybeSingle();
        if (
          channel?.status === "public_unverified" &&
          channel.external_channel_id
        )
          claimed.external_channel_id = channel.external_channel_id;
      }
      return claimed;
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
    videoCounts: async (hash, j, t, payload) => {
      const { data, error } = await db.rpc("svc_worker_video_counts", {
        credential_hash: hash,
        j,
        t,
        payload,
      });
      if (error) failed(error);
      return data;
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
