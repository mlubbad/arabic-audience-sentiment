import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  requireProjectRef,
  validateMigrationSql,
} from "./apply-migrations-remote.mjs";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const previewDeploy = readFileSync("scripts/deploy-preview.sh", "utf8");
const telegramRunner = readFileSync("scripts/run_telegram_collect.py", "utf8");
const adminE2e = readFileSync("tests/e2e/admin.spec.ts", "utf8");
const triggerBlock = workflow.slice(
  workflow.indexOf("on:"),
  workflow.indexOf("permissions:"),
);

describe("deployment verification gate", () => {
  test("waits for the main CI workflow instead of deploying directly", () => {
    expect(triggerBlock).toContain("workflow_run:");
    expect(triggerBlock).toContain('workflows: ["Credential-free checks"]');
    expect(triggerBlock).toContain("types: [completed]");
    expect(triggerBlock).toContain("branches: [main]");
    expect(triggerBlock).not.toMatch(/^\s+push:/m);
    expect(triggerBlock).toMatch(/^\s+workflow_dispatch:/m);
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
  });

  test("requires CI and Security success for the exact trusted commit", () => {
    expect(workflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      "github.event.workflow_run.head_branch == 'main'",
    );
    expect(workflow).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("require_workflow_jobs ci.yml verify");
    expect(workflow).toContain("require_workflow_jobs security.yml");
    expect(workflow).toContain(
      '"Secret scan" "Semgrep SAST" "Dependency audit"',
    );
    expect(workflow).toContain(
      "group: deploy-preview-${{ github.event.workflow_run.head_sha || github.sha }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("ref: ${{ env.TARGET_SHA }}");
  });

  test("fails on missing secrets and migrates before uploading", () => {
    expect(workflow).toContain("Missing required deployment secret");
    expect(workflow).not.toContain("Skipping FTP upload");
    expect(workflow).not.toContain("Skipping remote migration");

    const migrate = workflow.indexOf("run: npm run db:migrate:remote");
    const upload = workflow.indexOf("run: sh scripts/deploy-preview.sh");
    expect(migrate).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(migrate);
  });

  test("builds with the public Supabase config and refuses to build without it", () => {
    const build = workflow.slice(
      workflow.indexOf("- name: Build frontend distribution"),
      workflow.indexOf("- name: Apply remote database migrations"),
    );
    expect(build).toContain("VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}");
    expect(build).toContain(
      "VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(build).toContain(
      "for name in VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY; do",
    );
    expect(build).toContain("Missing required repository variable");
    expect(build.indexOf("exit 1")).toBeLessThan(
      build.indexOf("npm run build"),
    );
    // Public values only: a VITE_* name must never be fed from a secret.
    expect(build).not.toMatch(/VITE_\w+: \$\{\{ secrets\./);
  });

  test("verifies the live hostname serves the uploaded build, after the upload", () => {
    const upload = workflow.indexOf("run: sh scripts/deploy-preview.sh");
    const verify = workflow.indexOf("run: node scripts/verify-deploy.mjs");
    expect(verify).toBeGreaterThan(upload);
    expect(workflow).toContain(
      "DEPLOY_VERIFY_URL: https://app.sky-develop.net",
    );
  });
});

describe("remote migration safety", () => {
  test("requires an explicit Supabase project ref", () => {
    expect(() => requireProjectRef({})).toThrow(/SUPABASE_PROJECT_REF/);
    expect(
      requireProjectRef({ SUPABASE_PROJECT_REF: "syntheticproject123" }),
    ).toBe("syntheticproject123");
  });

  test("refuses transaction-breaking migration statements", () => {
    expect(() =>
      validateMigrationSql("select 1;\ncommit;", "unsafe_commit.sql"),
    ).toThrow(/COMMIT/);
    expect(() =>
      validateMigrationSql(
        "create index concurrently demo_idx on demo(id);",
        "unsafe_index.sql",
      ),
    ).toThrow(/CONCURRENTLY/);
    expect(() =>
      validateMigrationSql("create table demo(id bigint);", "safe.sql"),
    ).not.toThrow();
  });
});

describe("WO-1 credential and portability guards", () => {
  test("keeps FTP credentials out of argv and requires full TLS", () => {
    expect(previewDeploy).toContain("--ssl-reqd");
    expect(previewDeploy).toContain('--netrc-file "$netrc_file"');
    expect(previewDeploy).toContain('chmod 600 "$netrc_file"');
    expect(previewDeploy).not.toContain("--ftp-ssl-control");
    expect(previewDeploy).not.toMatch(/(?:^|\s)-u\s/);
  });

  test("requires the Telegram worker credential without a fallback", () => {
    expect(telegramRunner).toContain(
      'worker_cred = os.environ.get("WORKER_CREDENTIAL")',
    );
    expect(telegramRunner).toContain("WORKER_CREDENTIAL is required");
    expect(telegramRunner).not.toMatch(
      /WORKER_CREDENTIAL["'],\s*["'][a-f0-9]{32,}/,
    );
  });

  test("keeps e2e screenshots inside Playwright output", () => {
    expect(adminE2e).not.toContain("/Users/");
    expect(adminE2e).toContain('testInfo.outputPath("ui-admin-users.png")');
    expect(adminE2e).toContain(
      'testInfo.outputPath("ui-impersonating-user.png")',
    );
  });
});
