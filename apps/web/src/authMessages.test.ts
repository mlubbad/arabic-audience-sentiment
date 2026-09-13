import { describe, expect, it } from "vitest";
import {
  authErrorCode,
  authErrorMessage,
  authSuccessMessage,
} from "./authMessages";

describe("what the account screen says when sign-in fails", () => {
  it("tells a wrong password and a missing account apart from a broken project", () => {
    // The old screen said "check your data and account settings" for all three,
    // which leaves the person with nothing to act on.
    const credentials = authErrorMessage({ code: "invalid_credentials" });
    const disabled = authErrorMessage({ code: "signup_disabled" });
    const unconfirmed = authErrorMessage({ code: "email_not_confirmed" });
    expect(new Set([credentials, disabled, unconfirmed]).size).toBe(3);
    // And each one names the next step.
    expect(unconfirmed).toContain("رابط التأكيد");
    expect(authErrorMessage({ code: "user_already_exists" })).toContain(
      "تسجيل الدخول",
    );
  });

  it("does not say which of the two a wrong login was", () => {
    // Supabase returns one code for a bad password and for an address that was
    // never registered, deliberately: separating them would let anyone test
    // whether a given person has an account here. The wording keeps that.
    const m = authErrorMessage({ code: "invalid_credentials" });
    expect(m).toContain("أو");
    expect(m).not.toMatch(/غير مسجل|لا يوجد مستخدم بهذا/);
  });

  it("never repeats the server's own error text", () => {
    // A PostgREST or GoTrue message can quote the endpoint, and the endpoint
    // carries the key. Same rule as the worker gateway: a code, not a message.
    const leaky = {
      code: "some_new_code",
      message:
        "failed at https://proj.supabase.co/auth/v1?apikey=sb_secret_xyz",
    };
    const shown = authErrorMessage(leaky);
    expect(shown).not.toContain("supabase.co");
    expect(shown).not.toContain("sb_secret_xyz");
    // The code is shown, so the failure is still diagnosable.
    expect(shown).toContain("some_new_code");
  });

  it("falls back to the status when there is no code at all", () => {
    expect(authErrorCode({ status: 503 })).toBe("http_503");
    expect(authErrorCode({})).toBe("unknown_error");
    expect(authErrorCode({ code: "over_request_rate_limit" })).toBe(
      "over_request_rate_limit",
    );
  });
});

describe("what it says when it worked", () => {
  it("does not claim a signup signed you in when it did not", () => {
    // This project requires email confirmation, so signUp returns no session.
    // Saying "signed in" there is a lie the person discovers later, at an
    // empty dashboard.
    const created = authSuccessMessage("signup", false);
    expect(created).toContain("رابط التأكيد");
    expect(created).not.toBe(authSuccessMessage("signin", true));
  });

  it("says signed in when a session really was issued", () => {
    // With confirmation switched off, signUp does return a session.
    expect(authSuccessMessage("signup", true)).toBe("تم تسجيل الدخول.");
    expect(authSuccessMessage("signin", true)).toBe("تم تسجيل الدخول.");
  });
});
