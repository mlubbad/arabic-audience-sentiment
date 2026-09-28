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
});
