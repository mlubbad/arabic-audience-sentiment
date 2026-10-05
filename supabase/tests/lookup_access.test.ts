import { describe, expect, it } from "vitest";
import {
  lookupRefusal,
  refusalDetail,
} from "../functions/_shared/lookup-access";

const user = { id: "u-1" };
const ok = { user, userError: null, memberError: null };

describe("channel lookup access", () => {
  it("lets an owner or an analyst name a channel", () => {
    expect(
      lookupRefusal({ ...ok, memberships: [{ role: "workspace_owner" }] }),
    ).toBeNull();
    expect(
      lookupRefusal({ ...ok, memberships: [{ role: "analyst" }] }),
    ).toBeNull();
  });

  it("names a refused session apart from the other refusals", () => {
    expect(
      lookupRefusal({
        user: null,
        userError: { name: "AuthApiError", message: "invalid JWT" },
        memberships: null,
        memberError: null,
      }),
    ).toBe("forbidden:session");
    expect(
      lookupRefusal({
        user: null,
        userError: null,
        memberships: null,
        memberError: null,
      }),
    ).toBe("forbidden:session");
  });

  it("names a failed membership read", () => {
    expect(
      lookupRefusal({
        ...ok,
        memberships: null,
        memberError: { code: "42501" },
      }),
    ).toBe("forbidden:membership_read");
  });

  it("names a missing role, including a viewer and a non-member", () => {
    expect(lookupRefusal({ ...ok, memberships: [{ role: "viewer" }] })).toBe(
      "forbidden:role",
    );
    expect(lookupRefusal({ ...ok, memberships: [] })).toBe("forbidden:role");
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
