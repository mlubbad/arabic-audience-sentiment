/**
 * The worker gateway. Service role, because the worker's own credential is
 * scoped and the primitives it calls are not tenant-callable.
 *
 * The workspace is never read from the request: it is derived inside the
 * database from the hashed bearer this handler passes in.
 */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { handleWorkerRequest } from "../_shared/worker-gateway.ts";

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

Deno.serve((request) =>
  handleWorkerRequest(request, {
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
  }),
);
