/** The live page's one wire: a row's action becomes an RPC call. The row
 *  says `plan_key` (the column's name, and the reducer's); `set_workspace_plan`
 *  takes `plan`. This is the only place that renaming happens, so this is
 *  where it is pinned — with the other two payloads beside it. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() =>
  vi.fn<
    (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  >(),
);
vi.mock("../supabase", () => ({ supabase: { rpc } }));

import { callServer } from "./AdminPage";

const W = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("callServer", () => {
  it("set_plan → set_workspace_plan with `plan`, the months, the note (or null) and the override", async () => {
    await callServer({
      type: "set_plan",
      w: W,
      plan_key: "agency",
      months: 6,
      note: null,
      override: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_workspace_plan", {
      w: W,
      plan: "agency",
      months: 6,
      note: null,
      override: true,
    });
  });

  it("grant_pack → grant_pack with the kind, the units and the note", async () => {
    await callServer({
      type: "grant_pack",
      w: W,
      kind: "topic_classification",
      units: 2500,
      note: "حزمة الإطلاق",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("grant_pack", {
      w: W,
      kind: "topic_classification",
      units: 2500,
      note: "حزمة الإطلاق",
    });
  });

  it("delete → delete_workspace with the id alone", async () => {
    await callServer({ type: "delete", w: W });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("delete_workspace", { w: W });
  });

  it("a PostgREST error is thrown as it came, for adminErrorMessage to name", async () => {
    const error = { message: "paddle_subscription_active", code: "55000" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(
      callServer({
        type: "set_plan",
        w: W,
        plan_key: "agency",
        months: 1,
        note: null,
        override: false,
      }),
    ).rejects.toBe(error);
  });
});
