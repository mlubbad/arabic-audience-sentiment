#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env.local")) {
  const envContent = readFileSync(".env.local", "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required in environment or .env.local",
  );
  process.exit(1);
}

const projectRef =
  process.env.SUPABASE_PROJECT_ID ||
  process.env.SUPABASE_PROJECT_REF ||
  process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ||
  "ykqugctewsqvevhyqtbi";

async function queryRemote(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Remote query failed (${res.status}): ${JSON.stringify(data)}`,
    );
  }
  return data;
}

async function main() {
  console.log(`Connecting to Supabase project [${projectRef}]...`);

  await queryRemote(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      inserted_at timestamp with time zone default timezone('utc'::text, now()) not null
    );
  `);

  const appliedRows = await queryRemote(
    "select version from supabase_migrations.schema_migrations order by version asc;",
  );
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  const migrationsDir = "supabase/migrations";
  if (!existsSync(migrationsDir)) {
    console.log("No migrations directory found. Nothing to apply.");
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = [];
  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = match[1];
    if (!appliedVersions.has(version)) {
      pending.push({ version, file });
    }
  }

  if (pending.length === 0) {
    console.log(
      `Database is up to date (${appliedVersions.size} migrations applied, 0 pending).`,
    );
    return;
  }

  console.log(`Found ${pending.length} pending migration(s) to apply.`);

  for (const { version, file } of pending) {
    const filePath = join(migrationsDir, file);
    console.log(`Applying migration ${version} (${file})...`);
    const sqlContent = readFileSync(filePath, "utf8");

    const batch = `
      begin;
      ${sqlContent}
      insert into supabase_migrations.schema_migrations (version)
      values ('${version}')
      on conflict (version) do nothing;
      commit;
    `;

    await queryRemote(batch);
    console.log(`✓ Migration ${version} applied successfully.`);
  }

  try {
    await queryRemote("notify pgrst, 'reload schema';");
  } catch {
    // Non-fatal if notify fails
  }

  console.log("All pending migrations applied cleanly.");
}

main().catch((err) => {
  console.error("Migration error:", err.message);
  process.exit(1);
});
