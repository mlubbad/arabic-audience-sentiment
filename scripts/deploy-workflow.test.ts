import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
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
    expect(triggerBlock).not.toMatch(/^\s+workflow_dispatch:/m);
  });

  test("requires success and deploys the exact commit that passed CI", () => {
    expect(workflow).toContain(
      "if: github.event.workflow_run.conclusion == 'success'",
    );
    expect(workflow).toContain(
      "group: deploy-preview-${{ github.event.workflow_run.head_sha }}",
    );
    expect(workflow).toContain(
      "ref: ${{ github.event.workflow_run.head_sha }}",
    );
  });
});
