/**
 * What went wrong, in a form that is safe to put on the screen.
 *
 * The dashboard's error notice said "تعذر تحميل البيانات. حاول مرة أخرى." and
 * nothing else, deliberately: a PostgREST error can carry the request URL, and
 * that URL carries the project and the key. The caution was right and the
 * result was a screen that cannot be diagnosed by the person looking at it.
 *
 * Twice now the only way to find out why a read did not reach the page has
 * been to fetch the payload out of band and replay it through the contracts by
 * hand. The operator watching the failure had strictly less information than
 * the network tab beside it, which is the wrong way round.
 *
 * So: a code, never a message. It says which half failed and what kind of
 * failure it was, and it is built only from field names, issue codes and a
 * fixed vocabulary of our own — never from a server string, never from a
 * value, and never from an array index, which would say how many rows there
 * are and which one.
 */

/** Errors this application raises on purpose. Safe to name. */
const KNOWN = new Set([
  "live_unavailable",
  "fixture_unavailable",
  "invalid_cursor",
  "invalid_comment",
  "stale_comment_text",
  "review_rejected",
]);

type ZodLike = {
  name?: string;
  message?: string;
  code?: unknown;
  issues?: { code?: string; path?: (string | number | symbol)[] }[];
};

const SAFE_DATABASE_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

/**
 * A short, safe description of a failure.
 *
 * @param stage which half of the screen could not be produced.
 */
export function failureCode(stage: "read" | "view", error: unknown): string {
  const e = (error ?? {}) as ZodLike;

  // A schema rejection is the most useful case and the most dangerous to
  // print: a Zod message quotes the value it refused. The path and the issue
  // code say everything needed to fix it and quote nothing.
  const issue = e.issues?.[0];
  if (issue) {
    const where = (issue.path ?? [])
      // A numeric index is a count of the reader's own rows. `#` keeps the
      // shape of the path without saying which row or how many.
      .map((p) => (typeof p === "number" ? "#" : String(p)))
      .join(".");
    return `${stage}:${issue.code ?? "invalid"}${where ? `@${where}` : ""}`;
  }

  if (typeof e.message === "string" && KNOWN.has(e.message)) {
    const databaseCode =
      e.message === "live_unavailable" &&
      typeof e.code === "string" &&
      SAFE_DATABASE_CODE.test(e.code)
        ? `:${e.code}`
        : "";
    return `${stage}:${e.message}${databaseCode}`;
  }

  // Anything else is a bug rather than a condition, and its message is of
  // unknown provenance. The constructor name is ours to show; the message is
  // not.
  return `${stage}:unexpected:${e.name ?? "Error"}`;
}
