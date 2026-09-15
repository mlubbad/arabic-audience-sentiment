import { describe, expect, it, vi } from "vitest";
import {
  handleWorkerRequest,
  type WorkerDb,
} from "../../../supabase/functions/_shared/worker-gateway";

const CRED = "worker-credential-value";
// sha256("worker-credential-value"). Asserting the exact digest proves the
// algorithm, not merely that something 64 characters long was sent.
const HASHED =
  "8f9dde4fe74081af483578002b2c710223d3ff3359b471d8e8242bb64e7d1613";

function db(over: Partial<WorkerDb> = {}) {
  return {
    claim: vi.fn(async () => ({
      job_id: "j1",
      lease_token: "t1",
      checkpoint: null,
    })),
    heartbeat: vi.fn(async () => {}),
    commitBatch: vi.fn(async () => ({ replayed: false })),
    finish: vi.fn(async () => {}),
    ...over,
  } as unknown as WorkerDb & Record<string, ReturnType<typeof vi.fn>>;
}
const post = (
  path: string,
  body: unknown = {},
  auth: string | null = `Bearer ${CRED}`,
) =>
  new Request(`https://edge.invalid${path}`, {
    method: "POST",
    headers: auth
      ? { authorization: auth, "content-type": "application/json" }
      : {},
    body: JSON.stringify(body),
  });

describe("worker gateway", () => {
  it("hashes the credential and never passes the raw token to the database", async () => {
    const store = db();
    await handleWorkerRequest(post("/worker/claim"), store);
    const seen = (store.claim as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(seen).not.toBe(CRED);
    expect(seen).toBe(HASHED);
  });

  it("refuses a missing or malformed credential without touching the database", async () => {
    for (const auth of [null, "Basic abc", "Bearer", "Bearer  "]) {
      const store = db();
      const response = await handleWorkerRequest(
        post("/worker/claim", {}, auth),
        store,
      );
      expect(response.status).toBe(401);
      expect(store.claim).not.toHaveBeenCalled();
    }
  });

  it("answers no work with 204 rather than an error", async () => {
    const store = db({ claim: vi.fn(async () => null) });
    expect(
      (await handleWorkerRequest(post("/worker/claim"), store)).status,
    ).toBe(204);
  });

  it("maps each refusal to the status the worker client expects", async () => {
    const cases: [string, number][] = [
      ["invalid_worker_credential", 401],
      ["forbidden", 403],
      ["lease_lost", 409],
      ["batch_conflict", 409],
      ["quota_exceeded", 429],
      ["invalid_batch", 400],
      ["invalid_outcome", 400],
    ];
    for (const [code, status] of cases) {
      const store = db({
        heartbeat: vi.fn(async () => {
          throw Object.assign(new Error("db"), { code });
        }),
      });
      const response = await handleWorkerRequest(
        post("/worker/heartbeat", { job_id: "j1", lease_token: "t1" }),
        store,
      );
      expect([code, response.status]).toEqual([code, status]);
      expect(await response.json()).toEqual({ code });
    }
  });

  it("does not leak the credential or an internal message on failure", async () => {
    const store = db({
      claim: vi.fn(async () => {
        throw new Error(`connection to postgres failed using ${CRED}`);
      }),
    });
    const response = await handleWorkerRequest(post("/worker/claim"), store);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain(CRED);
    expect(body).not.toContain("postgres");
    expect(JSON.parse(body)).toEqual({ code: "control_plane_error" });
  });

  it("ignores a workspace the worker tries to supply", async () => {
    const store = db();
    await handleWorkerRequest(
      post("/worker/commit-batch", {
        job_id: "j1",
        lease_token: "t1",
        batch_key: "b",
        payload_hash: "0".repeat(64),
        payload: { external_video_id: "v" },
        workspace_id: "00000000-0000-4000-8000-000000000002",
      }),
      store,
    );
    // The workspace is the server's to decide, so nothing from the request body
    // reaches the database call at all.
    const args = (store.commitBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.stringify(args)).not.toContain(
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("requires the fields each route acts on", async () => {
    const store = db();
    for (const [path, body] of [
      ["/worker/heartbeat", { job_id: "j1" }],
      ["/worker/finish", { job_id: "j1", lease_token: "t1" }],
      [
        "/worker/commit-batch",
        { job_id: "j1", lease_token: "t1", batch_key: "b" },
      ],
    ] as const) {
      const response = await handleWorkerRequest(post(path, body), store);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "invalid_batch" });
    }
  });

  it("rejects an unknown route and a non-POST method", async () => {
    const store = db();
    expect(
      (await handleWorkerRequest(post("/worker/delete-everything"), store))
        .status,
    ).toBe(404);
    const get = new Request("https://edge.invalid/worker/claim", {
      method: "GET",
      headers: { authorization: `Bearer ${CRED}` },
    });
    expect((await handleWorkerRequest(get, store)).status).toBe(405);
  });

  it("routes the topic pair with only the fields the database reads", async () => {
    const store = db({
      topicsDue: vi.fn(async () => ({ classification_key: "k", active: true, taxonomy: [], rows: [] })),
      commitTopics: vi.fn(async () => ({ replayed: false, stored: 2 })),
    });
    const due = await handleWorkerRequest(
      post("/worker/topics-due", {
        job_id: "j1", lease_token: "t1", model_id: "gemini-2.5-flash", prompt_version: "p1",
        max_rows: 50, workspace_id: "ignored",
      }),
      store,
    );
    expect(due.status).toBe(200);
    expect(store.topicsDue).toHaveBeenCalledWith(HASHED, "j1", "t1", "gemini-2.5-flash", "p1", 50);
    const commit = await handleWorkerRequest(
      post("/worker/commit-topics", {
        job_id: "j1", lease_token: "t1", batch_key: "b", records: [{ external_comment_id: "c1" }],
      }),
      store,
    );
    expect(await commit.json()).toEqual({ replayed: false, stored: 2 });
    expect(store.commitTopics).toHaveBeenCalledWith(HASHED, "j1", "t1", "b", [{ external_comment_id: "c1" }]);
    for (const [path, body] of [
      ["/worker/topics-due", { job_id: "j1", lease_token: "t1", prompt_version: "p1" }],
      ["/worker/commit-topics", { job_id: "j1", lease_token: "t1", batch_key: "b", records: "no" }],
    ] as const) {
      const r = await handleWorkerRequest(post(path, body), store);
      expect(r.status).toBe(400);
    }
    const typed = await handleWorkerRequest(
      post("/worker/commit-topics", { job_id: "j1", lease_token: "t1", batch_key: "b", records: [] }),
      db({ commitTopics: vi.fn(async () => { throw { message: "invalid_job_type" }; }) }),
    );
    expect(typed.status).toBe(400);
    expect(await typed.json()).toEqual({ code: "invalid_job_type" });
  });
});
