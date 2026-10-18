import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Genre taxonomy v2 (roadmap 2026-10-17, task 0.4): levels 2 and 3 under
// v1's 18 level-1 genres, published as a new version beside an unchanged v1.
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

type Genre = {
  key: string;
  parent_key: string | null;
  level: number;
  name_ar: string;
  name_en: string;
  description: string;
  iab_id: string | null;
  position: number;
};
type Taxonomy = { version: number; genres: Genre[] };

const taxonomy = async (version?: number) =>
  (
    await db.query<{ t: Taxonomy }>(
      version === undefined
        ? "select public.genre_taxonomy() as t"
        : `select public.genre_taxonomy(${version}) as t`,
    )
  ).rows[0].t;

describe("genre taxonomy v2", () => {
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
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      OWNER,
    ]);
    await db.exec("set role authenticated");
  });
  afterAll(async () => {
    await db?.close();
  });

  it("is the latest version, and v1 is still its 18 level-1 genres", async () => {
    const latest = await taxonomy();
    expect(latest.version).toBe(2);
    expect(await taxonomy(2)).toEqual(latest);
    const v1 = await taxonomy(1);
    expect(v1.genres).toHaveLength(18);
    expect(v1.genres.every((g) => g.level === 1)).toBe(true);
  });

  it("keeps v1's level 1 exactly, and adds 120 level-2 and 27 level-3 genres", async () => {
    const { genres } = await taxonomy(2);
    const v1 = (await taxonomy(1)).genres;
    expect(genres.filter((g) => g.level === 1)).toEqual(v1);
    expect(genres.filter((g) => g.level === 2)).toHaveLength(120);
    expect(genres.filter((g) => g.level === 3)).toHaveLength(27);
  });

  it("hangs every genre off a parent one level up, with every level-1 genre split", async () => {
    const { genres } = await taxonomy(2);
    const byKey = new Map(genres.map((g) => [g.key, g]));
    expect(byKey.size).toBe(genres.length);
    for (const g of genres.filter((g) => g.level > 1)) {
      const parent = byKey.get(g.parent_key!);
      expect(parent?.level, g.key).toBe(g.level - 1);
    }
    for (const root of genres.filter((g) => g.level === 1))
      expect(
        genres.some((g) => g.parent_key === root.key),
        root.key,
      ).toBe(true);
  });

  it("numbers siblings 1 to n, and names no two siblings alike", async () => {
    const { genres } = await taxonomy(2);
    const groups = new Map<string, Genre[]>();
    for (const g of genres.filter((g) => g.level > 1))
      groups.set(g.parent_key!, [...(groups.get(g.parent_key!) ?? []), g]);
    for (const [parent, siblings] of groups) {
      expect(
        siblings.map((g) => g.position).sort((a, b) => a - b),
        parent,
      ).toEqual(siblings.map((_, i) => i + 1));
      expect(new Set(siblings.map((g) => g.name_ar)).size, parent).toBe(
        siblings.length,
      );
      expect(new Set(siblings.map((g) => g.name_en)).size, parent).toBe(
        siblings.length,
      );
    }
  });

  it("carries an Arabic name and description on every genre", async () => {
    const { genres } = await taxonomy(2);
    for (const g of genres) {
      expect(g.name_ar, g.key).toMatch(/[؀-ۿ]/);
      expect(g.description, g.key).toMatch(/[؀-ۿ]/);
    }
  });
});
