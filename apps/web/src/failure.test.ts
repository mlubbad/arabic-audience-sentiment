import { describe, expect, it } from "vitest";
import { z } from "zod";
import { failureCode } from "./failure";

describe("what a failure is allowed to say", () => {
  it("names the half that failed and the kind of failure", () => {
    expect(failureCode("read", new Error("live_unavailable"))).toBe(
      "read:live_unavailable",
    );
    expect(failureCode("view", new Error("invalid_cursor"))).toBe(
      "view:invalid_cursor",
    );
  });

  it("points at the field a schema refused", () => {
    const schema = z.object({ sync: z.object({ queued_jobs: z.number() }) });
    const bad = schema.safeParse({ sync: { queued_jobs: "many" } });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    // Enough to find it in the migration that produced it, on first reading.
    expect(failureCode("read", bad.error)).toBe(
      "read:invalid_type@sync.queued_jobs",
    );
  });

  it("does not say which row, or how many there are", () => {
    // A row index is a count of the reader's own data. The path still has to
    // show that the failure was inside the list rather than beside it.
    const schema = z.object({
      comments: z.array(z.object({ id: z.string() })),
    });
    const bad = schema.safeParse({
      comments: [{ id: "ok" }, { id: "ok" }, { id: 7 }],
    });
    if (bad.success) throw new Error("fixture no longer fails");
    const code = failureCode("read", bad.error);
    expect(code).toBe("read:invalid_type@comments.#.id");
    expect(code).not.toMatch(/\d/);
  });

  it("never repeats what the server said", () => {
    // The reason this notice was silent for so long: a PostgREST error can
    // carry the request URL, and the URL carries the project and the key.
    const leak = new Error(
      "https://project.supabase.co/rest/v1/rpc?apikey=sb_secret_abcdefghijklmnop",
    );
    const code = failureCode("read", leak);
    expect(code).toBe("read:unexpected:Error");
    expect(code).not.toContain("supabase");
    expect(code).not.toContain("apikey");
    expect(code).not.toContain("sb_secret");
  });

  it("never repeats a value a schema refused", () => {
    // Zod quotes the value in its message. The comment text of a real channel
    // must not reach an error notice, and neither must an author's name.
    const schema = z.object({ text_raw: z.enum(["a", "b"]) });
    const bad = schema.safeParse({ text_raw: "اسم مؤلف حقيقي" });
    if (bad.success) throw new Error("fixture no longer fails");
    const code = failureCode("read", bad.error);
    expect(code).not.toContain("اسم مؤلف حقيقي");
    expect(code).toMatch(/^read:[a-z_]+@text_raw$/);
  });

  it("survives being handed something that is not an error at all", () => {
    expect(failureCode("view", undefined)).toBe("view:unexpected:Error");
    expect(failureCode("view", "a string")).toBe("view:unexpected:Error");
    expect(failureCode("read", null)).toBe("read:unexpected:Error");
  });
});
