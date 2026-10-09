import { describe, expect, it } from "vitest";
import type { AdminConsoleChannel } from "@sentiment/contracts";
import {
  readFilter,
  scoped,
  stateCounts,
  visibleChannels,
  writeFilter,
  type ConsoleFilter,
} from "./channelsConsole";

const row = (
  over: Partial<AdminConsoleChannel> & Pick<AdminConsoleChannel, "id">,
): AdminConsoleChannel => ({
  workspace_id: "00000000-0000-4000-8000-000000000001",
  workspace_name: "ws",
  mine: true,
  owner_email: "owner@example.com",
  external_channel_id: "UC",
  title: null,
  handle: null,
  state: "healthy",
  last_ok_at: null,
  last_error: null,
  last_run_at: null,
  catalogued_at: null,
  videos: 0,
  selected: 0,
  comments: 0,
  analysed: 0,
  auto_initial: null,
  auto_daily: null,
  ...over,
});

const ROWS = [
  row({
    id: "a",
    title: "أنور المحبوب",
    state: "healthy",
    comments: 10,
    last_ok_at: "2026-10-09T06:00:00+00:00",
  }),
  row({ id: "b", title: "Noor Stars", state: "failing", comments: 500 }),
  row({
    id: "c",
    title: "Banderita",
    state: "stale",
    comments: 50,
    last_ok_at: "2026-10-01T06:00:00+00:00",
  }),
  row({
    id: "d",
    title: "Shop",
    state: "healthy",
    mine: false,
    owner_email: "customer@example.com",
    comments: 70,
    last_ok_at: "2026-10-08T06:00:00+00:00",
  }),
];
const ALL: ConsoleFilter = {
  state: "all",
  owner: "all",
  query: "",
  sort: "state",
};

describe("channels console filter", () => {
  it("reads the address, and falls back to the default for anything unknown", () => {
    expect(
      readFilter(
        new URLSearchParams("state=failing&owner=mine&q=noor&sort=name"),
      ),
    ).toEqual({
      state: "failing",
      owner: "mine",
      query: "noor",
      sort: "name",
    });
    expect(
      readFilter(new URLSearchParams("state=lost&owner=x&sort=y")),
    ).toEqual(ALL);
  });

  it("writes only what differs from the default, so the plain page has a plain address", () => {
    expect(writeFilter(ALL).toString()).toBe("");
    expect(writeFilter({ ...ALL, state: "stale", query: "x" }).toString()).toBe(
      "state=stale&q=x",
    );
  });

  it("puts trouble first by default", () => {
    expect(visibleChannels(ROWS, ALL).map((c) => c.id)).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
  });

  it("orders by most comments, and by longest since collection with never first", () => {
    expect(
      visibleChannels(ROWS, { ...ALL, sort: "comments" }).map((c) => c.id),
    ).toEqual(["b", "d", "c", "a"]);
    expect(
      visibleChannels(ROWS, { ...ALL, sort: "oldest" }).map((c) => c.id),
    ).toEqual(["b", "c", "d", "a"]);
  });

  it("keeps one state, one kind of account, and the channels a folded search names", () => {
    expect(
      visibleChannels(ROWS, { ...ALL, state: "healthy" }).map((c) => c.id),
    ).toEqual(["d", "a"]);
    expect(
      visibleChannels(ROWS, { ...ALL, owner: "customers" }).map((c) => c.id),
    ).toEqual(["d"]);
    expect(
      visibleChannels(ROWS, { ...ALL, owner: "mine" }).map((c) => c.id),
    ).toEqual(["b", "c", "a"]);
    expect(
      visibleChannels(ROWS, { ...ALL, query: "انور" }).map((c) => c.id),
    ).toEqual(["a"]);
    expect(
      visibleChannels(ROWS, { ...ALL, query: "customer@" }).map((c) => c.id),
    ).toEqual(["d"]);
  });

  it("counts states over the account and search choice, not over the chosen state", () => {
    expect(stateCounts(scoped(ROWS, { owner: "mine", query: "" }))).toEqual({
      failing: 1,
      stale: 1,
      waiting: 0,
      new: 0,
      cataloguing: 0,
      collecting: 0,
      healthy: 1,
      paused: 0,
    });
  });
});
