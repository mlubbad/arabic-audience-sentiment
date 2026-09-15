/**
 * The gateway handler with an injected data layer — the shape a deployed Edge
 * Function has, without a deployed project.
 */
import { describe, expect, it, vi } from "vitest";
import {
  handleWorkerRequest,
  type WorkerDb,
} from "../functions/_shared/worker-gateway";

const base = (): WorkerDb => ({
  claim: vi.fn(async () => null),
  heartbeat: vi.fn(async () => {}),
  commitBatch: vi.fn(async () => ({})),
  finish: vi.fn(async () => {}),
  commitCatalogue: vi.fn(async () => ({ videos: 0 })),
  videoFinished: vi.fn(async () => {}),
  tick: vi.fn(async () => ({ discover: 0, collect: 0 })),
});
const post = (db: WorkerDb, path = "/worker/claim", bearer = "cred") =>
  handleWorkerRequest(
    new Request(`https://edge.invalid${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
    db,
  );

describe("what a claim hands the worker", () => {
  it("gives a short-lived token, and never the refresh token", async () => {
    // The worker holds neither the sealing key nor the service role. Fetching
    // the grant itself would need both, and a compromised worker would gain
    // indefinite access to a channel rather than an hour of it.
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({
        id: "job-1",
        lease_token: "lease-1",
        checkpoint: null,
        type: "collect",
      }),
      accessTokenFor: async () => "ya29.short-lived",
    };
    const body = (await (await post(db)).json()) as Record<string, unknown>;
    expect(body.access_token).toBe("ya29.short-lived");
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "checkpoint",
      "job_id",
      "lease_token",
      "type",
      "videos",
    ]);
    expect(JSON.stringify(body)).not.toContain("refresh");
  });

  it("asks for the token against the claimed job, not against anything sent", async () => {
    // The lookup is keyed on the credential and the job, so a worker cannot
    // request a grant belonging to a workspace it does not own.
    const accessTokenFor = vi.fn(async () => "t");
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "job-7", lease_token: "l", checkpoint: null }),
      accessTokenFor,
    };
    await post(db);
    expect(accessTokenFor).toHaveBeenCalledWith(expect.any(String), "job-7");
    // The credential passed on is the hash, never the bearer as sent.
    const [passedHash] = accessTokenFor.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(passedHash).not.toBe("cred");
  });

  it("still returns the job when the channel has no usable grant", async () => {
    // A channel nobody has connected is a fact about the channel. Refusing the
    // claim would leave the job queued with nothing to explain it; the worker
    // takes it and reports blocked, which someone can act on.
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "job-1", lease_token: "l", checkpoint: null }),
      accessTokenFor: async () => null,
    };
    const response = await post(db);
    expect(response.status).toBe(200);
    expect((await response.json()).access_token).toBeNull();
  });

  it("says there is no work without asking for a token at all", async () => {
    const accessTokenFor = vi.fn(async () => "t");
    const response = await post({ ...base(), accessTokenFor });
    expect(response.status).toBe(204);
    expect(accessTokenFor).not.toHaveBeenCalled();
  });
});

describe("the due list and the catalogue", () => {
  const send = (db: WorkerDb, path: string, body: unknown) =>
    handleWorkerRequest(
      new Request(`https://edge.invalid${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer cred",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      db,
    );

  it("hands a collect claim its due videos, and a discover claim none", async () => {
    const dueVideos = vi.fn(async () => [
      { video_id: "v", external_video_id: "a".repeat(11), title: "t" },
    ]);
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({
        id: "j",
        lease_token: "l",
        checkpoint: null,
        type: "collect",
      }),
      dueVideos,
    };
    const body = (await (await post(db)).json()) as {
      type: string;
      videos: unknown[];
    };
    expect(body.type).toBe("collect");
    expect(body.videos).toHaveLength(1);
    expect(dueVideos).toHaveBeenCalledWith(expect.any(String), "j", "l");

    const discover: WorkerDb = {
      ...base(),
      claim: async () => ({
        id: "j",
        lease_token: "l",
        checkpoint: null,
        type: "discover",
      }),
      dueVideos,
    };
    const d = (await (await post(discover)).json()) as {
      type: string;
      videos: unknown[];
    };
    expect(d).toMatchObject({ type: "discover", videos: [] });
    expect(dueVideos).toHaveBeenCalledTimes(1);
  });

  it("commits a catalogue only as an array under a live lease", async () => {
    const db = base();
    const bad = await send(db, "/worker/commit-catalogue", {
      job_id: "j",
      lease_token: "l",
      payload: {},
    });
    expect(bad.status).toBe(400);
    const ok = await send(db, "/worker/commit-catalogue", {
      job_id: "j",
      lease_token: "l",
      payload: [],
    });
    expect(ok.status).toBe(200);
    expect(db.commitCatalogue).toHaveBeenCalledWith(
      expect.any(String),
      "j",
      "l",
      [],
    );
  });

  it("records a video's end with its outcome and code", async () => {
    const db = base();
    const r = await send(db, "/worker/video-finished", {
      job_id: "j",
      lease_token: "l",
      video_id: "v",
      outcome: "blocked",
      error_code: "comments_disabled",
    });
    expect(r.status).toBe(200);
    expect(db.videoFinished).toHaveBeenCalledWith(
      expect.any(String),
      "j",
      "l",
      "v",
      "blocked",
      "comments_disabled",
    );
    const missing = await send(db, "/worker/video-finished", {
      job_id: "j",
      lease_token: "l",
    });
    expect(missing.status).toBe(400);
  });

  it("ticks without a lease and maps a refused catalogue to 400", async () => {
    const db = base();
    const t = await send(db, "/worker/tick", {});
    expect(t.status).toBe(200);
    expect(await t.json()).toEqual({ discover: 0, collect: 0 });
    const refusing: WorkerDb = {
      ...base(),
      commitCatalogue: async () => {
        throw { code: "invalid_catalogue" };
      },
    };
    const r = await send(refusing, "/worker/commit-catalogue", {
      job_id: "j",
      lease_token: "l",
      payload: [],
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ code: "invalid_catalogue" });
  });
});
