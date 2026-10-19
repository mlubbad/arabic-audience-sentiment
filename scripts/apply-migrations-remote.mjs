#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { versionProblems } from "./check-migrations.mjs";

export function loadLocalEnv() {
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
}

export function requireProjectRef(env = process.env) {
  const projectRef = env.SUPABASE_PROJECT_REF;
  if (!projectRef) {
    throw new Error(
      "SUPABASE_PROJECT_REF is required in environment or .env.local",
    );
  }
  if (!/^[a-z0-9]+$/.test(projectRef)) {
    throw new Error(
      "SUPABASE_PROJECT_REF must contain only lowercase letters and digits",
    );
  }
  return projectRef;
}

export function validateMigrationSql(sqlContent, file) {
  if (/(?:^|[;\r\n])\s*commit\s*;/i.test(sqlContent)) {
    throw new Error(
      `Migration ${file} contains a COMMIT statement; migrations are wrapped transactionally`,
    );
  }
  if (/\bconcurrently\b/i.test(sqlContent)) {
    throw new Error(
      `Migration ${file} contains CONCURRENTLY, which cannot run inside the deployment transaction`,
    );
  }
}

async function queryRemote(sql, token, projectRef) {
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
  loadLocalEnv();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required in environment or .env.local",
    );
  }
  const projectRef = requireProjectRef();

  const migrationsDir = "supabase/migrations";
  if (!existsSync(migrationsDir)) {
    console.log("No migrations directory found. Nothing to apply.");
    return;
  }

  // A second file with an applied version would be skipped below without a
  // word, so refuse the whole run instead.
  const problems = versionProblems(readdirSync(migrationsDir));
  if (problems.length) throw new Error(problems.join("\n"));

  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) => {
      const match = file.match(/^(\d+)_/);
      if (!match) return [];
      const sqlContent = readFileSync(join(migrationsDir, file), "utf8");
      validateMigrationSql(sqlContent, file);
      return [{ version: match[1], file, sqlContent }];
    });

  console.log(`Connecting to Supabase project [${projectRef}]...`);

  await queryRemote(
    `
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      inserted_at timestamp with time zone default timezone('utc'::text, now()) not null
    );
  `,
    token,
    projectRef,
  );

  const appliedRows = await queryRemote(
    "select version from supabase_migrations.schema_migrations order by version asc;",
    token,
    projectRef,
  );
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  const pending = migrations.filter(
    ({ version }) => !appliedVersions.has(version),
  );

  if (pending.length === 0) {
    console.log(
      `Database is up to date (${appliedVersions.size} migrations applied, 0 pending).`,
    );
    return;
  }

  console.log(`Found ${pending.length} pending migration(s) to apply.`);

  for (const { version, file, sqlContent } of pending) {
    console.log(`Applying migration ${version} (${file})...`);

    const batch = `
      begin;
      ${sqlContent}
      insert into supabase_migrations.schema_migrations (version)
      values ('${version}')
      on conflict (version) do nothing;
      commit;
    `;

    await queryRemote(batch, token, projectRef);
    console.log(`✓ Migration ${version} applied successfully.`);
  }

  try {
    await queryRemote("notify pgrst, 'reload schema';", token, projectRef);
  } catch {
    // Non-fatal if notify fails
  }

  console.log("All pending migrations applied cleanly.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error("Migration error:", err.message);
    process.exitCode = 1;
  });
}
