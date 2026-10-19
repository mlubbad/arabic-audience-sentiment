import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-0000000000a1";
const U = "10000000-0000-4000-8000-0000000000a1";
const C = "20000000-0000-4000-8000-0000000000a1";
let db: PGlite;

describe("channel genre profiles", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1)", [U]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$2)",
      [W, U],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W,
      U,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A')",
      [W],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'pilot','active',now()-interval '1 day',now()+interval '30 days')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,catalogued_at) values ($1,$2,$3,'UC_A','connected',now())",
      [C, W, W],
    );
    await db.query(
      "update private.platform_switches set enabled=true where key='genre_classification'",
    );
  });
  afterAll(async () => db?.close());

  it("deletes profiles below five succeeded videos and normalizes rolled-up levels", async () => {
    const videos = Array.from(
      { length: 5 },
      (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    for (let i = 0; i < 5; i++) {
      await db.query(
        "insert into videos(id,workspace_id,channel_id,external_video_id,title,published_at,view_count) values ($1,$2,$3,$4,'v',now(),null)",
        [videos[i], W, C, `v${i}`],
      );
      await db.query(
        "insert into video_genre_predictions(workspace_id,video_id,classification_key,taxonomy_version,status,genre_key,model_id,prompt_version) values ($1,$2,'genres:v2+m+g1',2,'succeeded',$3,'m','g1')",
        [W, videos[i], i === 0 ? "fb_arab_leagues" : "sports_basketball"],
      );
      if (i === 3)
        await db.query<{ n: number }>(
          "select private.refresh_channel_genres($1,$2,'genres:v2+m+g1')",
          [W, C],
        );
    }
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from channel_genres where channel_id=$1",
          [C],
        )
      ).rows[0].n,
    ).toBe(0);
    const started = performance.now();
    await db.query(
      "select private.refresh_channel_genres($1,$2,'genres:v2+m+g1')",
      [W, C],
    );
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    const levels = (
      await db.query<{ level: number; total: number }>(
        "select level,sum(weight)::float total from channel_genres where channel_id=$1 group by level",
        [C],
      )
    ).rows;
    expect(levels.length).toBe(3);
    for (const row of levels) expect(row.total).toBeCloseTo(1, 4);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U]);
    await db.exec("set role authenticated");
    const profile = (
      await db.query<{ result: Record<string, unknown> }>(
        "select public.channel_genre_profile($1) result",
        [C],
      )
    ).rows[0].result;
    expect(profile.source).toBe("model");
    expect(profile.videos).toBe(5);
  });

  it("blocks the profile when the policy switch is off", async () => {
    await db.exec("reset role");
    await db.query(
      "update private.platform_switches set enabled=false where key='genre_classification'",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U]);
    await db.exec("set role authenticated");
    expect(
      (
        await db.query<{ result: Record<string, unknown> }>(
          "select public.channel_genre_profile($1) result",
          [C],
        )
      ).rows[0].result,
    ).toEqual({ blocked: "genre_classification_off" });
  });

  it("uses one latest classification key and sums channel videos across Main genres", async () => {
    await db.exec("reset role");
    await db.query(
      "update private.platform_switches set enabled=true where key='genre_classification'",
    );
    await db.query("delete from channel_genres where channel_id=$1", [C]);
    const mains = (
      await db.query<{ key: string }>(
        "select key from genre_taxonomy where version=2 and level=1 order by position limit 2",
      )
    ).rows;
    expect(mains).toHaveLength(2);
    await db.query(
      `insert into channel_genres(workspace_id,channel_id,classification_key,taxonomy_version,genre_key,level,weight,videos,computed_at)
       values ($1,$2,'old-key',2,$3,1,.99,3,now()-interval '1 minute'),
              ($1,$2,'old-key',2,$4,1,.01,3,now()-interval '1 minute'),
              ($1,$2,'new-key',2,$3,1,.5,3,now()),
              ($1,$2,'new-key',2,$4,1,.5,3,now())`,
      [W, C, mains[0].key, mains[1].key],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U]);
    await db.exec("set role authenticated");
    const profile = (
      await db.query<{ result: Record<string, unknown> }>(
        "select public.channel_genre_profile($1) result",
        [C],
      )
    ).rows[0].result;
    expect(profile.classification_key).toBe("new-key");
    expect(profile.main).toBe(mains[0].key);
    expect(profile.videos).toBe(6);
    expect(profile.weights).toHaveLength(2);
  });

  it("excludes Primary's level-three child from Secondary", async () => {
    await db.exec("reset role");
    await db.query(
      "update private.platform_switches set enabled=true where key='genre_classification'",
    );
    await db.query("delete from channel_genres where channel_id=$1", [C]);
    const tree = (
      await db.query<{
        main: string;
        primary: string;
        child: string;
        outside: string;
      }>(
        `select m.key main, p.key primary, c.key child, x.key outside
           from genre_taxonomy m
           join genre_taxonomy p on p.version=m.version and p.parent_key=m.key and p.level=2
           join genre_taxonomy c on c.version=p.version and c.parent_key=p.key and c.level=3
           join genre_taxonomy p2 on p2.version=m.version and p2.parent_key=m.key and p2.key<>p.key and p2.level=2
           join genre_taxonomy x on x.version=p2.version and x.parent_key=p2.key and x.level=3
          where m.version=2 order by m.position,p.position,c.position,x.position limit 1`,
      )
    ).rows[0];
    await db.query(
      `insert into channel_genres(workspace_id,channel_id,classification_key,taxonomy_version,genre_key,level,weight,videos,computed_at)
       values ($1,$2,'secondary-key',2,$3,1,1,5,now()),
              ($1,$2,'secondary-key',2,$4,2,1,5,now()),
              ($1,$2,'secondary-key',2,$5,3,.3,2,now()),
              ($1,$2,'secondary-key',2,$6,3,.3,2,now())`,
      [W, C, tree.main, tree.primary, tree.child, tree.outside],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U]);
    await db.exec("set role authenticated");
    const profile = (
      await db.query<{ result: { secondary: string[] } }>(
        "select public.channel_genre_profile($1) result",
        [C],
      )
    ).rows[0].result;
    expect(profile.secondary).toContain(tree.outside);
    expect(profile.secondary).not.toContain(tree.child);
  });
});
