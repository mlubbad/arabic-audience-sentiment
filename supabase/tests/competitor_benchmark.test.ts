import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
const A = "00000000-0000-4000-8000-0000000000a1",
  B = "00000000-0000-4000-8000-0000000000b1";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$; create schema private;
    create table public.channels(id uuid primary key, workspace_id uuid, external_channel_id text, title text, handle text);
    create table public.competitor_candidates(workspace_id uuid, channel_id uuid, platform text, candidate_external_id text, title text, handle text);
    create table public.competitor_decisions(workspace_id uuid, channel_id uuid, platform text, candidate_external_id text, status text);
    create table public.channel_stats_daily(workspace_id uuid, channel_id uuid, day date, subscriber_count bigint, view_count bigint, video_count bigint);
    create table public.competitor_stats_daily(workspace_id uuid, channel_id uuid, candidate_external_id text, day date, subscriber_count bigint, view_count bigint, video_count bigint);
    create function private.has_role(w uuid) returns boolean language sql stable as $$select w='${A}'::uuid$$;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261120000000_competitor_benchmark.sql",
      "utf8",
    ),
  );
  await db.query(
    "insert into channels values ($1,$1,'UCA','Own',null),($2,$2,'UCB','Other',null)",
    [A, B],
  );
  await db.query(
    "insert into competitor_candidates values ($1,$1,'youtube','UCX','Tracked',null),($1,$1,'youtube','UCY','Dismissed',null)",
    [A],
  );
  await db.query(
    "insert into competitor_decisions values ($1,$1,'youtube','UCX','tracked'),($1,$1,'youtube','UCY','dismissed')",
    [A],
  );
  await db.query(
    "insert into channel_stats_daily values ($1,$1,current_date-8,10,100,4),($1,$1,current_date,20,180,2)",
    [A],
  );
  await db.query(
    "insert into competitor_stats_daily values ($1,$1,'UCX',current_date,30,90,0)",
    [A],
  );
});
afterAll(async () => db.close());
describe("competitor_benchmark", () => {
  it("computes changes, retains negative video delta, and omits untracked candidates", async () => {
    type Result = {
      series: { external_id: string; kpis: Record<string, number | null> }[];
    };
    const { rows } = await db.query<{ b: Result }>(
      "select competitor_benchmark($1,30) b",
      [A],
    );
    const series = rows[0]!.b.series;
    expect(series.map((x) => x.external_id)).toEqual(["UCA", "UCX"]);
    expect(series[0].kpis).toMatchObject({
      subscribers_change: 10,
      views_change: 80,
      videos_per_week: -1.75,
      views_per_video: 90,
    });
    expect(series[1].kpis).toMatchObject({
      subscribers_change: null,
      views_per_video: null,
      videos_per_week: null,
    });
  });
  it("rejects invalid windows and another workspace", async () => {
    await expect(
      db.query("select competitor_benchmark($1,6)", [A]),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.query("select competitor_benchmark($1,30)", [B]),
    ).rejects.toThrow("forbidden");
  });
});
