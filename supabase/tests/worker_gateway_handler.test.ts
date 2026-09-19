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
  topicsDue: vi.fn(async () => ({})),
  commitTopics: vi.fn(async () => ({})),
  tick: vi.fn(async () => ({ discover: 0, collect: 0 })),
});
const post = (
  db: WorkerDb,
  path = "/worker/claim",
  bearer = "cred",
  body: unknown = {},
) =>
  handleWorkerRequest(
    new Request(`https://edge.invalid${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    db,
  );

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

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
      accessTokenFor: async () => ({
        access_token: "ya29.short-lived",
        access_token_expires_at: "2026-09-19T17:00:00Z",
      }),
    };
    const body = (await (await post(db)).json()) as Record<string, unknown>;
    expect(body.access_token).toBe("ya29.short-lived");
    // The expiry travels with the token, so the worker can ask for a fresh
    // one before the current lapses mid-run instead of losing the run to it.
    expect(body.access_token_expires_at).toBe("2026-09-19T17:00:00Z");
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "access_token_expires_at",
      "checkpoint",
      "external_channel_id",
      "job_id",
      "lease_token",
      "type",
      "videos",
    ]);
    expect(JSON.stringify(body)).not.toContain("refresh");
  });

  it("hands the platform id only for a public channel", async () => {
    // A channel registered as public data has no grant to open; its id is
    // what lets a key-carrying worker know what it was sent to read. A
    // connected channel's id never travels: a failed grant is the worker's
    // signal to report the channel unconnected, not a door to public
    // collection nobody decided on.
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({
        id: "job-2",
        lease_token: "l",
        checkpoint: null,
        type: "discover",
        external_channel_id: "UCTPIL6f7yNpK8yc-H3cEtFg",
      }),
      accessTokenFor: async () => null,
    };
    const first = (await (await post(db)).json()) as Record<string, unknown>;
    expect(first.access_token).toBeNull();
    expect(first.external_channel_id).toBe("UCTPIL6f7yNpK8yc-H3cEtFg");

    const connected: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "job-3", lease_token: "l", checkpoint: null }),
      accessTokenFor: async () => null,
    };
    const second = (await (await post(connected)).json()) as Record<
      string,
      unknown
    >;
    expect(second.external_channel_id).toBeNull();
  });

  it("a public claim without a grant reads through the platform reader", async () => {
    // The chain at claim time: the channel's own grant first (none here),
    // then the platform reader — the operator's one grant that reads any
    // public channel. Its token answers in the same field the owner's would;
    // the id travels beside it either way.
    const readerTokenFor = vi.fn(async () => ({
      access_token: "ya29.platform-reader",
      access_token_expires_at: "2026-09-19T17:00:00Z",
    }));
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({
        id: "job-4",
        lease_token: "l",
        checkpoint: null,
        type: "discover",
        external_channel_id: "UCTPIL6f7yNpK8yc-H3cEtFg",
      }),
      accessTokenFor: async () => null,
      readerTokenFor,
    };
    const body = (await (await post(db)).json()) as Record<string, unknown>;
    expect(body.access_token).toBe("ya29.platform-reader");
    expect(body.external_channel_id).toBe("UCTPIL6f7yNpK8yc-H3cEtFg");
    expect(readerTokenFor).toHaveBeenCalledWith(expect.any(String));
    // A connected channel never reaches for the reader — its grant decides.
    const connected: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "job-5", lease_token: "l", checkpoint: null }),
      accessTokenFor: async () => null,
      readerTokenFor,
    };
    const second = (await (await post(connected)).json()) as Record<
      string,
      unknown
    >;
    expect(second.access_token).toBeNull();
    expect(readerTokenFor).toHaveBeenCalledTimes(1);
  });

  it("asks for the token against the claimed job, not against anything sent", async () => {
    // The lookup is keyed on the credential and the job, so a worker cannot
    // request a grant belonging to a workspace it does not own.
    const accessTokenFor = vi.fn(async () => ({
      access_token: "t",
      access_token_expires_at: "2026-09-19T17:00:00Z",
    }));
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
    const accessTokenFor = vi.fn(async () => ({
      access_token: "t",
      access_token_expires_at: "2026-09-19T17:00:00Z",
    }));
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

  it("passes the comment counts through as an array and hands back what is still to read", async () => {
    // The route exists so a collect run can spend one unit on fifty counts
    // before spending one per page on each video. The handler validates the
    // shape it can see — an array — and the database judges the items.
    const videoCounts = vi.fn(async () => ({
      read: ["a".repeat(11)],
      unchanged: 1,
      updated: 2,
    }));
    const db: WorkerDb = { ...base(), videoCounts };
    const payload = [
      { external_video_id: "a".repeat(11), comment_count: 3 },
      { external_video_id: "b".repeat(11), comment_count: null },
    ];
    const ok = await send(db, "/worker/video-counts", {
      job_id: "j",
      lease_token: "l",
      payload,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      read: ["a".repeat(11)],
      unchanged: 1,
      updated: 2,
    });
    expect(videoCounts).toHaveBeenCalledWith(
      expect.any(String),
      "j",
      "l",
      payload,
    );

    const bad = await send(db, "/worker/video-counts", {
      job_id: "j",
      lease_token: "l",
      payload: { external_video_id: "a".repeat(11), comment_count: 3 },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: "invalid_counts" });
    expect(videoCounts).toHaveBeenCalledTimes(1);

    const noLease = await send(db, "/worker/video-counts", { payload: [] });
    expect(noLease.status).toBe(400);
  });

  it("maps the database's invalid_counts to 400 by message as well as by code", async () => {
    // A real driver puts the SQLSTATE in `code` and the label in the message,
    // as the other 22023 refusals do.
    for (const thrown of [
      { code: "invalid_counts" },
      { code: "22023", message: "invalid_counts" },
    ]) {
      const refusing: WorkerDb = {
        ...base(),
        videoCounts: async () => {
          throw thrown;
        },
      };
      const r = await send(refusing, "/worker/video-counts", {
        job_id: "j",
        lease_token: "l",
        payload: [],
      });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ code: "invalid_counts" });
    }
  });

  it("a gateway without the binding answers the route as not found", async () => {
    // A worker built after this route against a gateway built before it: a
    // 404 the worker's counts step treats as a failure to fall back from,
    // never a reason to read nothing.
    const r = await send(base(), "/worker/video-counts", {
      job_id: "j",
      lease_token: "l",
      payload: [],
    });
    expect(r.status).toBe(404);
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

  it("passes the requested kinds of work to the data layer, cleaned", async () => {
    // A collection-only run asks for collections. A body whose types are
    // malformed asks for anything: an unparseable scope must never become a
    // narrower one by accident. The data layer sees the hashed credential,
    // never the bearer as sent.
    const hash = await sha256Hex("cred");
    const db = base();
    await send(db, "/worker/claim", { types: ["collect"] });
    expect(db.claim).toHaveBeenCalledWith(hash, ["collect"]);
    await send(db, "/worker/claim", { types: ["collect", 7, "discover"] });
    expect(db.claim).toHaveBeenCalledWith(hash, ["collect", "discover"]);
    await send(db, "/worker/claim", { types: [] });
    expect(db.claim).toHaveBeenCalledWith(hash, null);
    await send(db, "/worker/claim", { types: "collect" });
    expect(db.claim).toHaveBeenCalledWith(hash, null);
    await send(db, "/worker/claim", {});
    expect(db.claim).toHaveBeenCalledWith(hash, null);
  });
});

describe("the mid-run token renewal", () => {
  const renew = (db: WorkerDb, body: Record<string, unknown>) =>
    post(db, "/worker/renew-token", "cred", body);

  it("hands a fresh token and its expiry against a held lease", async () => {
    const renewToken = vi.fn(async () => ({
      access_token: "ya29.renewed",
      access_token_expires_at: "2026-09-19T18:00:00Z",
    }));
    const r = await renew(
      { ...base(), renewToken },
      {
        job_id: "j",
        lease_token: "l",
      },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      access_token: "ya29.renewed",
      access_token_expires_at: "2026-09-19T18:00:00Z",
    });
  });

  it("carries the hashed credential and the lease the request named", async () => {
    const renewToken = vi.fn(async () => null);
    await renew(
      { ...base(), renewToken },
      {
        job_id: "job-2",
        lease_token: "lease-2",
        workspace_id: "forged",
      },
    );
    expect(renewToken).toHaveBeenCalledWith(
      expect.any(String),
      "job-2",
      "lease-2",
    );
    // The workspace is derived inside the data layer, never read from the body.
    const [passedHash] = renewToken.mock.calls[0] as unknown as [string];
    expect(passedHash).not.toBe("cred");
  });

  it("answers without a token when the channel's grant is gone", async () => {
    // A fact about the channel, not a fault to retry: the worker stops
    // asking, and the retry path reports the channel to the operator.
    const r = await renew(
      { ...base(), renewToken: async () => null },
      { job_id: "j", lease_token: "l" },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toBeNull();
  });

  it("maps a lost lease to its own refusal, not a 500", async () => {
    // Someone else holds the job. Minting them no tokens, and telling the
    // worker which refusal it was, ends the run without overwriting results.
    const r = await renew(
      {
        ...base(),
        renewToken: async () => {
          throw { message: "lease_lost" };
        },
      },
      { job_id: "j", lease_token: "l" },
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ code: "lease_lost" });
  });

  it("a gateway without the binding answers the route as not found", async () => {
    // A worker built after this route against a gateway built before it:
    // the 404 the worker's renewal step treats as "no renewal", and the run
    // falls back to the retryable credential lapse it always reported.
    const r = await renew(base(), { job_id: "j", lease_token: "l" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ code: "not_found" });
  });
});
