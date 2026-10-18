import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
let db: PGlite;

const as = async (role: "anon" | "authenticated", user = "") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
};

const taxonomy = async (version?: number) => {
  const result =
    version === undefined
      ? await db.query<{ taxonomy: Taxonomy }>(
          "select public.genre_taxonomy() as taxonomy",
        )
      : await db.query<{ taxonomy: Taxonomy }>(
          "select public.genre_taxonomy($1) as taxonomy",
          [version],
        );
  return result.rows[0].taxonomy;
};

type Taxonomy = {
  version: number;
  genres: Array<{
    key: string;
    parent_key: string | null;
    level: number;
    name_ar: string;
    name_en: string;
    description: string;
    iab_id: string | null;
    position: number;
  }>;
};

describe("genre taxonomy", () => {
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
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      OWNER,
      OTHER_OWNER,
    ]);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("returns the same ordered v1 taxonomy to users of different workspaces", async () => {
    // v1 by number: the latest version is v2 (genre_taxonomy_v2.test.ts).
    await as("authenticated", OWNER);
    const latest = await taxonomy(1);
    await as("authenticated", OTHER_OWNER);
    const explicit = await taxonomy(1);

    expect(latest).toEqual(explicit);
    expect(latest.version).toBe(1);
    expect(latest.genres).toHaveLength(18);
    expect(latest.genres.map(({ key, iab_id }) => [key, iab_id])).toEqual([
      ["entertainment", "JLBCU7"],
      ["comedy", null],
      ["education", "132"],
      ["news_politics", null],
      ["religion", "453"],
      ["sports", "483"],
      ["gaming", "680"],
      ["food", "210"],
      ["technology", "596"],
      ["kids_family", null],
      ["beauty_fashion", "552"],
      ["business_finance", "52"],
      ["health_fitness", "223"],
      ["travel", "653"],
      ["automotive", "1"],
      ["music", null],
      ["lifestyle_vlogs", null],
      ["documentary_history", null],
    ]);
    expect(
      latest.genres.map(({ level, parent_key, position }) => [
        level,
        parent_key,
        position,
      ]),
    ).toEqual(Array.from({ length: 18 }, (_, index) => [1, null, index + 1]));
  });

  it("refuses anonymous RPC calls", async () => {
    await as("anon");
    await expect(taxonomy()).rejects.toThrow(/permission denied/);
  });

  it("refuses authenticated direct reads and writes on both tables", async () => {
    await as("authenticated", OWNER);
    for (const statement of [
      "select * from public.genre_taxonomy_versions",
      "insert into public.genre_taxonomy_versions(version) values (2)",
      "select * from public.genre_taxonomy",
      `insert into public.genre_taxonomy(version,key,level,name_ar,name_en,description,position)
       values (1,'forbidden',1,'ممنوع','Forbidden','Forbidden direct write',99)`,
    ]) {
      await expect(db.query(statement)).rejects.toThrow(/permission denied/);
    }
  });

  it("enforces root shape, child shape, parent depth, and key format", async () => {
    // A scratch version: 1 and 2 are the published ones.
    await db.exec("reset role");
    await db.query(
      "insert into public.genre_taxonomy_versions(version, notes) values (99, 'constraint tests')",
    );
    await db.query(
      `insert into public.genre_taxonomy(version,key,level,name_ar,name_en,description,position)
       values (99,'root',1,'جذر','Root','Root genre',1)`,
    );

    await expect(
      db.query(
        `insert into public.genre_taxonomy(version,key,parent_key,level,name_ar,name_en,description,position)
         values (99,'root_with_parent','root',1,'جذر','Root','Invalid root',2)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.genre_taxonomy(version,key,level,name_ar,name_en,description,position)
         values (99,'orphan',2,'يتيم','Orphan','Invalid child',2)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.genre_taxonomy(version,key,parent_key,level,name_ar,name_en,description,position)
         values (99,'skipped_level','root',3,'خاطئ','Skipped','Invalid parent depth',2)`,
      ),
    ).rejects.toThrow(/invalid_genre_parent_level/);
    await expect(
      db.query(
        `insert into public.genre_taxonomy(version,key,level,name_ar,name_en,description,position)
         values (99,'Bad-Key',1,'خاطئ','Bad key','Invalid key',2)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown version as invalid_input", async () => {
    await as("authenticated", OWNER);
    await expect(taxonomy(999)).rejects.toMatchObject({
      code: "22023",
      message: "invalid_input",
    });
  });
});
