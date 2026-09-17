/**
 * The selection outlives the page, and belongs to the account that made it.
 *
 * The defect these replace: `useState(null)` in two lazily-loaded routes, so
 * the chosen workspace died on every navigation and each page asked again from
 * nothing. A test that only checked "set it, read it back" would have passed
 * against the old code too — inside one component, `useState` does exactly
 * that. What the old code could not do is survive a module that is torn down
 * and read from somewhere else, and be refused to a different user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWorkspaceSelection,
  selectWorkspace,
  selectionFor,
} from "./workspaceSelection";

/** These tests run in node, where there is no `localStorage` at all — which is
 *  itself worth knowing: the module reaches for it through `?.` precisely
 *  because it must run where it is absent (server render) or forbidden
 *  (private browsing). The stub is the browser half. */
function stubStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  vi.stubGlobal("localStorage", store);
  return store;
}

const A = "user-a";
const B = "user-b";
const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  stubStorage();
  resetWorkspaceSelection();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the chosen workspace", () => {
  it("is readable by the same user after the page that chose it is gone", () => {
    selectWorkspace(A, WS);
    expect(selectionFor(A)).toBe(WS);
  });

  it("is not handed to a different account on the same machine", () => {
    // The rule `useWorkspaces` already applies to the list. Persisting the
    // selection is only safe because it applies here too.
    selectWorkspace(A, WS);
    expect(selectionFor(B)).toBeNull();
    expect(selectionFor(null)).toBeNull();
  });

  it("comes back when the first user returns", () => {
    selectWorkspace(A, WS);
    expect(selectionFor(B)).toBeNull();
    expect(selectionFor(A)).toBe(WS);
  });

  it("is cleared by choosing nothing", () => {
    selectWorkspace(A, WS);
    selectWorkspace(A, null);
    expect(selectionFor(A)).toBeNull();
  });

  it("survives a reload — it is read back from storage, not from memory", () => {
    selectWorkspace(A, WS);
    const stored = globalThis.localStorage.getItem("audience.workspace");
    expect(stored).toBeTruthy();
    // A fresh module is what a reload actually is. Memory is gone; only what
    // reached storage can come back.
    vi.resetModules();
    globalThis.localStorage.setItem("audience.workspace", stored as string);
    return import("./workspaceSelection").then((fresh) => {
      expect(fresh.selectionFor(A)).toBe(WS);
      expect(fresh.selectionFor(B)).toBeNull();
    });
  });

  it("degrades to asking again when storage refuses", () => {
    // Safari's private mode throws on setItem. A remembered convenience is
    // never worth a blank screen, so the failure has to be swallowed and the
    // product has to keep working — which means behaving as it did before.
    const store = stubStorage();
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => selectWorkspace(A, WS)).not.toThrow();
    // Still answered from memory within this session.
    expect(selectionFor(A)).toBe(WS);
  });

  it("ignores a malformed stored value rather than trusting it", () => {
    globalThis.localStorage.setItem("audience.workspace", "{not json");
    vi.resetModules();
    return import("./workspaceSelection").then((fresh) => {
      expect(fresh.selectionFor(A)).toBeNull();
    });
  });
});

describe("both pages read the one selection", () => {
  // The store above can be perfect and the defect still be present: it comes
  // back the moment either page keeps its own `useState` for the choice again.
  // That is a source fact, not a behavioural one — the two pages cannot be
  // rendered together in a unit test, and the browser suite has no signed-in
  // account with two workspaces to drive the flow.
  const pages = ["dashboard/Dashboard.tsx", "Sync.tsx"];
  for (const file of pages) {
    it(`${file} does not hold the chosen workspace itself`, async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(src).toContain("useWorkspaceSelection");
      expect(src).not.toMatch(/const \[chosen, setChosen\] = useState/);
    });
  }
});
