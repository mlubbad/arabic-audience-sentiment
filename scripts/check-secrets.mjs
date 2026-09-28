import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

const embeddedUrlCredentials =
  /[a-z][a-z0-9+.-]*:\/\/([^/\s:@]+):([^@/\s]+)@[^/\s]+/gi;

// Obvious non-secret tokens used in documentation and examples. A URL
// credential counts as a placeholder when both parts are angle-bracketed
// (<user>) or dictionary placeholders, so documented examples like
// scheme://user:password@host never trip the scan while a real
// user:secret@host still does.
const PLACEHOLDER_WORDS = new Set([
  "user",
  "username",
  "pass",
  "passwd",
  "password",
  "example",
  "host",
  "hostname",
  "changeme",
  "placeholder",
  "dummy",
  "xxx",
]);

function isPlaceholderPart(value) {
  return /^<[^>]+>$/.test(value) || PLACEHOLDER_WORDS.has(value.toLowerCase());
}

function isPlaceholder(username, password) {
  return isPlaceholderPart(username) && isPlaceholderPart(password);
}

export function containsEmbeddedUrlCredentials(content) {
  embeddedUrlCredentials.lastIndex = 0;
  for (const match of content.matchAll(embeddedUrlCredentials)) {
    if (!isPlaceholder(match[1], match[2])) return true;
  }
  return false;
}

function containsForbiddenSecret(content) {
  return (
    forbidden.some((pattern) => pattern.test(content)) ||
    containsEmbeddedUrlCredentials(content)
  );
}

function scanBundle(path, violations) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) scanBundle(file, violations);
    else if (containsForbiddenSecret(readFileSync(file, "utf8")))
      violations.push(file);
  }
}

export function main() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const violations = [];

  for (const file of files) {
    if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example"))
      violations.push(file);
    if (!existsSync(file)) continue;
    // A tracked symlink can name a directory (e.g. .agents/skills); a
    // directory has no content to scan and readFileSync on one throws.
    if (statSync(file).isDirectory()) continue;
    const content = readFileSync(file, "utf8");
    if (containsForbiddenSecret(content)) violations.push(file);
    if (
      file.startsWith("apps/web/src/") &&
      /SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|WORKER_CREDENTIAL|TOKEN_ENCRYPTION_KEY|PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET/.test(
        content,
      )
    )
      violations.push(file);
  }

  scanBundle("apps/web/dist", violations);
  if (violations.length) {
    console.error(
      `Secret scan failed in: ${[...new Set(violations)].join(", ")}`,
    );
    return 1;
  }
  console.log(
    `Secret-pattern and frontend-boundary checks passed (${files.length} source files, plus built assets). Not a guarantee against every secret format.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
