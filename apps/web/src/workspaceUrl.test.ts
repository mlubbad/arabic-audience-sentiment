import { describe, expect, it } from "vitest";
import {
  carriedSearch,
  reconcileSelection,
  searchWithWorkspace,
  workspaceFromSearch,
} from "./workspaceUrl";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("the workspace in the address", () => {
  it("reads ws, and reads nothing from an empty or blank one", () => {
    expect(workspaceFromSearch(`?ws=${A}`)).toBe(A);
    expect(workspaceFromSearch(`?demo=1&ws=${A}`)).toBe(A);
    expect(workspaceFromSearch("?ws=")).toBeNull();
    expect(workspaceFromSearch("?ws=%20")).toBeNull();
    expect(workspaceFromSearch("")).toBeNull();
    expect(workspaceFromSearch(new URLSearchParams(`ws=${B}`))).toBe(B);
  });

  it("sets, replaces and removes ws without touching anything else", () => {
    expect(searchWithWorkspace("", A).toString()).toBe(`ws=${A}`);
    expect(searchWithWorkspace(`?ws=${A}`, B).toString()).toBe(`ws=${B}`);
    // The operations page's demo switch has to survive a choice.
    expect(searchWithWorkspace(`?demo=1&ws=${A}`, B).toString()).toBe(
      `demo=1&ws=${B}`,
    );
    expect(searchWithWorkspace(`?demo=1&ws=${A}`, null).toString()).toBe(
      "demo=1",
    );
  });
});

describe("address against memory", () => {
  it("the address wins, and is remembered", () => {
    expect(reconcileSelection({ inUrl: B, stored: A, signedIn: true })).toEqual(
      { selected: B, remember: B, writeUrl: null },
    );
    // Already in step: nothing to write anywhere.
    expect(reconcileSelection({ inUrl: B, stored: B, signedIn: true })).toEqual(
      { selected: B, remember: null, writeUrl: null },
    );
  });

  it("a remembered choice is shown and written back to the address", () => {
    expect(
      reconcileSelection({ inUrl: null, stored: A, signedIn: true }),
    ).toEqual({ selected: A, remember: null, writeUrl: A });
  });

  it("nothing anywhere is nothing", () => {
    expect(
      reconcileSelection({ inUrl: null, stored: null, signedIn: true }),
    ).toEqual({ selected: null, remember: null, writeUrl: null });
  });

  it("honours a visitor's link without trying to remember it for nobody", () => {
    // Signed out there is no account to key the memory by. The id still goes
    // to `workspaceState`, which answers "sign in" — the link is not lost, it
    // is waiting.
    expect(
      reconcileSelection({ inUrl: B, stored: null, signedIn: false }),
    ).toEqual({ selected: B, remember: null, writeUrl: null });
  });
});

describe("carrying the choice to another page", () => {
  it("carries ws alone, and nothing when there is none", () => {
    expect(carriedSearch(`?demo=1&ws=${A}`)).toBe(`?ws=${A}`);
    expect(carriedSearch("?demo=1")).toBe("");
    expect(carriedSearch("")).toBe("");
  });
});
