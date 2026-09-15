/**
 * The interface language: remembered, validated, defaulting to Arabic, and
 * written onto the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyToDocument,
  currentLocale,
  direction,
  otherLocale,
  resetLocale,
  setLocale,
} from "./locale";
import { ar } from "./strings/ar";
import { en } from "./strings/en";

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

beforeEach(() => {
  stubStorage();
  resetLocale();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the interface language", () => {
  it("is Arabic until asked otherwise, and is not read from the browser", () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(currentLocale()).toBe("ar");
  });

  it("remembers the choice across a reload", () => {
    const map = stubStorage();
    resetLocale();
    setLocale("en");
    expect(map.get("audience.locale")).toBe("en");
    resetLocale();
    // A fresh module reading the same storage: the reload.
    map.set("audience.locale", "en");
    expect(currentLocale()).toBe("en");
  });

  it("refuses a stored value it does not know, so a hand-edited key costs only the default", () => {
    stubStorage({ "audience.locale": "fr" });
    resetLocale();
    expect(currentLocale()).toBe("ar");
    stubStorage({ "audience.locale": '{"x":1}' });
    resetLocale();
    expect(currentLocale()).toBe("ar");
    // And the setter will not take one either, whatever the caller claims.
    setLocale("xx" as never);
    expect(currentLocale()).toBe("ar");
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {},
    });
    resetLocale();
    expect(currentLocale()).toBe("ar");
    expect(() => setLocale("en")).not.toThrow();
    expect(currentLocale()).toBe("en");
  });

  it("pairs the language with its direction and its alternative", () => {
    expect(direction("ar")).toBe("rtl");
    expect(direction("en")).toBe("ltr");
    expect(otherLocale("ar")).toBe("en");
    expect(otherLocale("en")).toBe("ar");
  });

  it("writes lang and dir onto the document together", () => {
    const doc = { documentElement: { lang: "", dir: "" } } as Document;
    applyToDocument("en", doc);
    expect(doc.documentElement).toMatchObject({ lang: "en", dir: "ltr" });
    applyToDocument("ar", doc);
    expect(doc.documentElement).toMatchObject({ lang: "ar", dir: "rtl" });
  });
});

describe("the two string sets", () => {
  const keys = Object.keys(ar) as (keyof typeof ar)[];

  it("cover the same keys — the type says so, and this says so at runtime too", () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
  });

  it("are each written in their own script, with no Arabic left in the English", () => {
    // Sentences, code tables and word lists alike; counted sentences are
    // functions and are exercised where they are used.
    const leaves = (v: unknown, path: string): [string, string][] =>
      typeof v === "string"
        ? [[path, v]]
        : Array.isArray(v)
          ? v.flatMap((x, i) => leaves(x, `${path}[${i}]`))
          : v && typeof v === "object"
            ? Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}.${k}`))
            : [];
    for (const key of keys) {
      const a = ar[key];
      const e = en[key];
      expect(typeof e, key).toBe(typeof a);
      const arabic = leaves(a, key);
      const english = leaves(e, key);
      expect(
        english.map(([p]) => p),
        key,
      ).toEqual(arabic.map(([p]) => p));
      for (const [path, text] of arabic) expect(text.trim(), path).not.toBe("");
      for (const [path, text] of english) {
        expect(text.trim(), path).not.toBe("");
        if (path !== "switchToOther")
          expect(text, path).not.toMatch(/[\u0600-\u06FF]/);
      }
    }
    // The one deliberate exception: the switch names the other language in
    // that language.
    expect(en.switchToOther).toBe("العربية");
  });
});

describe("English counts", () => {
  it("change the noun at one, and only at one", () => {
    expect(en.pillComments("1")).toBe("1 comment");
    expect(en.pillComments("2")).toBe("2 comments");
    expect(en.pillComments("1,234")).toBe("1,234 comments");
    expect(en.insightUndated("1")).toMatch(/^1 comment has /);
    expect(en.insightUndated("0")).toMatch(/^0 comments have /);
    expect(en.dashRead("1", 1)).toBe(
      "1 comment read across 1 video, with who said them and when.",
    );
    expect(en.engagedUnranked(1)).toMatch(/1 negative comment has .* was not/);
  });
});
