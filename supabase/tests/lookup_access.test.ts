import { describe, expect, it } from "vitest";
import {
  lookupRefusal,
  refusalDetail,
} from "../functions/_shared/lookup-access";

describe("channel lookup access", () => {
  it("lets an owner or an analyst name a channel", () => {
    expect(
      lookupRefusal({ role: "workspace_owner", roleError: null }),
    ).toBeNull();
    expect(lookupRefusal({ role: "analyst", roleError: null })).toBeNull();
  });

  it("names a token PostgREST refused, and an anon caller, as the session", () => {
    expect(lookupRefusal({ role: null, roleError: { code: "PGRST301" } })).toBe(
      "forbidden:session",
    );
    expect(lookupRefusal({ role: null, roleError: { code: "PGRST303" } })).toBe(
      "forbidden:session",
    );
    expect(lookupRefusal({ role: null, roleError: { code: "42501" } })).toBe(
      "forbidden:session",
    );
  });

  it("names any other failed role read apart from the session", () => {
    expect(lookupRefusal({ role: null, roleError: { code: "22P02" } })).toBe(
      "forbidden:membership_read",
    );
    expect(lookupRefusal({ role: null, roleError: { code: "" } })).toBe(
      "forbidden:membership_read",
    );
  });

  it("names a missing role, including a viewer and a non-member", () => {
    expect(lookupRefusal({ role: "viewer", roleError: null })).toBe(
      "forbidden:role",
    );
    expect(lookupRefusal({ role: null, roleError: null })).toBe(
      "forbidden:role",
    );
  });
});

describe("refusal detail for the log", () => {
  it("keeps only the error's name, code and message", () => {
    expect(
      refusalDetail({
        name: "AuthApiError",
        code: "bad_jwt",
        message: "invalid JWT",
        token: "eyJ.secret",
      }),
    ).toEqual({
      name: "AuthApiError",
      code: "bad_jwt",
      message: "invalid JWT",
    });
  });

  it("caps a long message and ignores a non-object", () => {
    expect(refusalDetail({ message: "x".repeat(500) }).message).toHaveLength(
      200,
    );
    expect(refusalDetail(null)).toEqual({});
    expect(refusalDetail("boom")).toEqual({});
  });
});
