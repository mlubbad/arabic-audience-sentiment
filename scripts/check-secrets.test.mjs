import assert from "node:assert/strict";
import test from "node:test";

import { containsEmbeddedUrlCredentials } from "./check-secrets.mjs";

test("detects credentials embedded in a proxy URL", () => {
  const syntheticUrl = [
    "https://synthetic-customer-zone",
    "synthetic-password@proxy.example.test:9515",
  ].join(":");

  assert.equal(containsEmbeddedUrlCredentials(syntheticUrl), true);
});

test("allows documented URL credential placeholders", () => {
  assert.equal(
    containsEmbeddedUrlCredentials("https://user:pass@proxy.example.test"),
    false,
  );
  assert.equal(
    containsEmbeddedUrlCredentials("https://USER:PASSWORD@proxy.example.test"),
    false,
  );
  assert.equal(
    containsEmbeddedUrlCredentials(
      "https://<proxy-user>:<proxy-password>@proxy.example.test",
    ),
    false,
  );
  // The literal example used in docs/agents/work-orders/WO-1.md.
  assert.equal(
    containsEmbeddedUrlCredentials("scheme://user:password@host"),
    false,
  );
});

test("still flags a real-looking embedded credential", () => {
  // Built from parts so the literal credential never appears in this file.
  const realCredentialUrl = [
    "wss://acme-customer-42",
    "s3cr3tKey@brd.example.test:9515",
  ].join(":");

  assert.equal(containsEmbeddedUrlCredentials(realCredentialUrl), true);
});
