import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  declaredVerifyJwt,
  deployArgs,
  deployedProblems,
  localFunctions,
  planDeploy,
} from "./deploy-functions.mjs";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

const at = (iso: string) => Date.parse(iso);
const live = (updated: string, verify_jwt: boolean, version = 3) => ({
  slug: "x",
  version,
  status: "ACTIVE",
  verify_jwt,
  updated_at: at(updated),
});
const change = (iso: string) => ({ sha: "54402a0abc", at: at(iso) });

describe("verify_jwt declarations", () => {
  test("every deployable function declares verify_jwt in config.toml", () => {
    const declared = declaredVerifyJwt(config);
    const functions = localFunctions();
    expect(functions).toContain("worker");
    expect(functions).not.toContain("_shared");
    for (const name of functions) expect(declared.has(name), name).toBe(true);
  });

  test("the functions production runs without the JWT check stay declared that way", () => {
    // Read from the Management API on 2026-10-19. A deploy with verify_jwt on
    // would lock the worker's credential and the OAuth redirect out.
    const declared = declaredVerifyJwt(config);
    for (const name of [
      "worker",
      "oauth-callback",
      "oauth-start",
      "paddle-webhook",
    ])
      expect(declared.get(name), name).toBe(false);
  });

  test("reads only [functions.NAME] sections and ignores comments", () => {
    const declared = declaredVerifyJwt(
      [
        "[auth]",
        "verify_jwt = false",
        "# [functions.ghost]",
        "[functions.worker] # trailing",
        "verify_jwt = false # bearer is a worker credential",
        "[functions.admin-users]",
        "verify_jwt = true",
        "[analytics]",
        "verify_jwt = false",
      ].join("\n"),
    );
    expect([...declared]).toEqual([
      ["worker", false],
      ["admin-users", true],
    ]);
  });
});

describe("planDeploy", () => {
  const base = {
    functions: ["worker", "admin-users", "brand-new"],
    declared: new Map([
      ["worker", false],
      ["admin-users", true],
      ["brand-new", true],
    ]),
  };

  test("deploys what production runs older than main, and what it lacks", () => {
    const plan = planDeploy({
      ...base,
      live: new Map([
        ["worker", live("2026-10-16T20:07:00Z", false)],
        ["admin-users", live("2026-10-19T07:00:00Z", true)],
      ]),
      lastChange: new Map([
        ["worker", change("2026-10-18T16:59:00Z")],
        ["admin-users", change("2026-10-18T16:59:00Z")],
        ["brand-new", change("2026-10-18T16:59:00Z")],
      ]),
    });
    expect(plan.refused).toEqual([]);
    expect(plan.stale).toEqual(["worker", "brand-new"]);
  });

  test("refuses the whole run when config.toml and production disagree on verify_jwt", () => {
    const plan = planDeploy({
      ...base,
      functions: ["worker", "admin-users"],
      live: new Map([
        ["worker", live("2026-10-16T20:07:00Z", true)],
        ["admin-users", live("2026-10-16T20:07:00Z", true)],
      ]),
      lastChange: new Map([
        ["worker", change("2026-10-18T16:59:00Z")],
        ["admin-users", change("2026-10-18T16:59:00Z")],
      ]),
    });
    expect(plan.refused).toEqual([
      expect.stringMatching(
        /^worker: .*verify_jwt = false, production runs true/,
      ),
    ]);
  });

  test("refuses a function with no verify_jwt declaration", () => {
    const plan = planDeploy({
      functions: ["fresh"],
      declared: new Map(),
      live: new Map(),
      lastChange: new Map([["fresh", change("2026-10-18T16:59:00Z")]]),
    });
    expect(plan.refused).toEqual([
      expect.stringMatching(/^fresh: no \[functions\.fresh\] verify_jwt/),
    ]);
  });

  test("names a production function main no longer has, and never removes it", () => {
    const plan = planDeploy({
      functions: ["worker"],
      declared: new Map([["worker", false]]),
      live: new Map([
        ["worker", live("2026-10-19T07:19:00Z", false)],
        ["retired", live("2026-09-01T00:00:00Z", true)],
      ]),
      lastChange: new Map([["worker", change("2026-10-18T16:59:00Z")]]),
    });
    expect(plan.stale).toEqual([]);
    expect(plan.unknown).toEqual(["retired"]);
  });
});

describe("deployArgs", () => {
  test("passes --no-verify-jwt only for a function declared without the check", () => {
    expect(deployArgs("worker", "syntheticref", false)).toContain(
      "--no-verify-jwt",
    );
    expect(deployArgs("admin-users", "syntheticref", true)).not.toContain(
      "--no-verify-jwt",
    );
  });

  test("uses the repository's CLI, server-side bundling and an explicit project", () => {
    const args = deployArgs("worker", "syntheticref", false);
    expect(args.slice(0, 5)).toEqual([
      "--no-install",
      "supabase",
      "functions",
      "deploy",
      "worker",
    ]);
    expect(args).toContain("--use-api");
    expect(args.join(" ")).toContain("--project-ref syntheticref");
    expect(args).not.toContain("--prune");
  });
});

describe("deployedProblems", () => {
  const before = live("2026-10-16T20:07:00Z", false, 35);

  test("passes when updated_at moved and the function is active with its declared check", () => {
    expect(
      deployedProblems(
        "worker",
        before,
        live("2026-10-19T08:00:00Z", false, 36),
        false,
      ),
    ).toEqual([]);
  });

  test("fails when updated_at did not move", () => {
    expect(deployedProblems("worker", before, before, false)).toEqual([
      expect.stringMatching(/^worker: updated_at did not move/),
    ]);
  });

  test("fails when the JWT check flipped or the function is missing", () => {
    expect(
      deployedProblems(
        "worker",
        before,
        live("2026-10-19T08:00:00Z", true, 36),
        false,
      ),
    ).toEqual(["worker: verify_jwt true, expected false"]);
    expect(deployedProblems("worker", before, null, false)).toEqual([
      "worker: not found in production after the deploy",
    ]);
  });
});

describe("deploy.yml edge function step", () => {
  const step = workflow.slice(
    workflow.indexOf("- name: Deploy changed edge functions"),
    workflow.indexOf("- name: Deploy frontend to preview host via FTPS"),
  );

  test("runs after the migrations and before the frontend upload", () => {
    const migrate = workflow.indexOf("run: npm run db:migrate:remote");
    const functions = workflow.indexOf("run: npm run functions:deploy");
    const upload = workflow.indexOf("run: sh scripts/deploy-preview.sh");
    expect(migrate).toBeGreaterThan(-1);
    expect(functions).toBeGreaterThan(migrate);
    expect(upload).toBeGreaterThan(functions);
  });

  test("takes the token and project from secrets and the commit it verified", () => {
    expect(step).toContain(
      "SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    );
    expect(step).toContain(
      "SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}",
    );
    expect(step).not.toMatch(/echo .*SUPABASE_ACCESS_TOKEN/);
    expect(workflow).toContain(
      "TARGET_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}",
    );
  });

  test("checks out full history, which the staleness comparison reads", () => {
    const checkout = workflow.slice(
      workflow.indexOf("- name: Checkout verified commit"),
      workflow.indexOf("- name: Setup Node.js"),
    );
    expect(checkout).toContain("fetch-depth: 0");
    expect(checkout).toContain("persist-credentials: false");
  });
});
