import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:sb_secret_|ghp_)[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  // Paddle's API key and webhook secret. The client-side token
  // (test_... / live_... + alphanumerics) is public by design and not listed.
  /\bpdl_(?:sdbx_|live_)?apikey_[A-Za-z0-9_]{20,}\b/,
  /\bpdl_ntf(?:set|_)[A-Za-z0-9_]{10,}\b/,
];
const violations = [];
for (const file of files) {
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example"))
    violations.push(file);
  if (!existsSync(file)) continue;
  const content = readFileSync(file, "utf8");
  if (forbidden.some((pattern) => pattern.test(content))) violations.push(file);
  if (
    file.startsWith("apps/web/src/") &&
    /SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|WORKER_CREDENTIAL|TOKEN_ENCRYPTION_KEY|PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET/.test(
      content,
    )
  )
    violations.push(file);
}
function scanBundle(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const f = `${path}/${entry.name}`;
    if (entry.isDirectory()) scanBundle(f);
    else if (forbidden.some((p) => p.test(readFileSync(f, "utf8"))))
      violations.push(f);
  }
}
scanBundle("apps/web/dist");
if (violations.length) {
  console.error(
    `Secret scan failed in: ${[...new Set(violations)].join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `Secret-pattern and frontend-boundary checks passed (${files.length} source files, plus built assets). Not a guarantee against every secret format.`,
);
