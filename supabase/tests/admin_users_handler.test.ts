import { describe, expect, it, vi } from "vitest";
import {
  adminUserAction,
  SUSPEND_FOR,
  type AdminUsersDb,
  type AuthAdmin,
  type Target,
} from "../functions/_shared/admin-users";

const USER = "10000000-0000-4000-8000-000000000002";
const APP = "https://app.example.com";
const PERSON: Target = {
  email: "customer@example.com",
  is_admin: false,
  is_self: false,
};

function fakes(target: Target | Error = PERSON) {
  const db: AdminUsersDb & { record: ReturnType<typeof vi.fn> } = {
    target: vi.fn(async () => {
      if (target instanceof Error) throw target;
      return target;
    }),
    record: vi.fn(async () => {}),
  };
  const auth: AuthAdmin & {
    update: ReturnType<typeof vi.fn>;
    recoveryLink: ReturnType<typeof vi.fn>;
  } = {
    recoveryLink: vi.fn(async () => "https://project.example/verify?t=1"),
    update: vi.fn(async () => {}),
  };
  return { db, auth };
}

const run = (
  body: unknown,
  f: ReturnType<typeof fakes>,
  origin: string | null = APP,
) => adminUserAction(body, origin, [APP], f.db, f.auth);

describe("admin-users handler", () => {
  it("suspends for a hundred years, lifts with none, and records each", async () => {
    const f = fakes();
    expect(await run({ action: "suspend", user_id: USER }, f)).toEqual({
      status: 200,
      body: { ok: true, recorded: true },
    });
    expect(f.auth.update).toHaveBeenCalledWith(USER, {
      ban_duration: SUSPEND_FOR,
    });
    expect(f.db.record).toHaveBeenCalledWith(USER, "user_suspended");

    await run({ action: "unsuspend", user_id: USER }, f);
    expect(f.auth.update).toHaveBeenLastCalledWith(USER, {
      ban_duration: "none",
    });
    expect(f.db.record).toHaveBeenLastCalledWith(USER, "user_unsuspended");
  });

  it("never suspends the caller or another platform admin", async () => {
    for (const t of [
      { ...PERSON, is_self: true },
      { ...PERSON, is_admin: true },
    ]) {
      const f = fakes(t);
      expect(await run({ action: "suspend", user_id: USER }, f)).toEqual({
        status: 409,
        body: { code: "cannot_suspend_admin" },
      });
      expect(f.auth.update).not.toHaveBeenCalled();
    }
  });

  it("makes a reset link that lands on the app's own reset page", async () => {
    const f = fakes();
    expect(await run({ action: "recovery_link", user_id: USER }, f)).toEqual({
      status: 200,
      body: {
        ok: true,
        recorded: true,
        link: "https://project.example/verify?t=1",
      },
    });
    expect(f.auth.recoveryLink).toHaveBeenCalledWith(
      PERSON.email,
      `${APP}/reset-password`,
    );
    expect(f.db.record).toHaveBeenCalledWith(USER, "password_link_created");
  });

  it("makes no link for an origin that is not the app's, nor for a person with no email", async () => {
    const f = fakes();
    expect(
      await run(
        { action: "recovery_link", user_id: USER },
        f,
        "https://evil.example",
      ),
    ).toEqual({ status: 400, body: { code: "invalid_origin" } });
    expect(
      await run({ action: "recovery_link", user_id: USER }, f, null),
    ).toEqual({ status: 400, body: { code: "invalid_origin" } });
    const g = fakes({ ...PERSON, email: null });
    expect(await run({ action: "recovery_link", user_id: USER }, g)).toEqual({
      status: 409,
      body: { code: "no_email" },
    });
    expect(f.auth.recoveryLink).not.toHaveBeenCalled();
    expect(g.auth.recoveryLink).not.toHaveBeenCalled();
  });

  it("confirms an email by hand", async () => {
    const f = fakes();
    await run({ action: "confirm_email", user_id: USER }, f);
    expect(f.auth.update).toHaveBeenCalledWith(USER, { email_confirm: true });
    expect(f.db.record).toHaveBeenCalledWith(USER, "email_confirmed");
  });

  it("changes an email, trimmed and lower-cased, marked confirmed", async () => {
    const f = fakes();
    await run(
      { action: "change_email", user_id: USER, email: "  New@Example.com " },
      f,
    );
    expect(f.auth.update).toHaveBeenCalledWith(USER, {
      email: "new@example.com",
      email_confirm: true,
    });
    expect(f.db.record).toHaveBeenCalledWith(USER, "email_changed");
  });

  it("names an address another account holds, and nothing else of Auth's answer", async () => {
    const f = fakes();
    f.auth.update.mockRejectedValueOnce({
      code: "email_exists",
      message: "A user with this email address has already been registered",
    });
    expect(
      await run(
        { action: "change_email", user_id: USER, email: "taken@example.com" },
        f,
      ),
    ).toEqual({ status: 409, body: { code: "email_taken" } });
    f.auth.update.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED postgres://secret"),
    );
    expect(await run({ action: "suspend", user_id: USER }, f)).toEqual({
      status: 502,
      body: { code: "unavailable" },
    });
    expect(f.db.record).not.toHaveBeenCalled();
  });

  it("refuses a malformed request before asking anyone", async () => {
    const f = fakes();
    for (const body of [
      null,
      { action: "delete", user_id: USER },
      { action: "suspend", user_id: "not-a-uuid" },
      { action: "change_email", user_id: USER, email: "nope" },
      { action: "change_email", user_id: USER },
    ])
      expect(await run(body, f)).toEqual({
        status: 400,
        body: { code: "invalid_request" },
      });
    expect(f.db.target).not.toHaveBeenCalled();
  });

  it("passes on the database's refusals, and hides any other failure", async () => {
    expect(
      await run(
        { action: "suspend", user_id: USER },
        fakes(new Error("forbidden")),
      ),
    ).toEqual({ status: 403, body: { code: "forbidden" } });
    expect(
      await run(
        { action: "suspend", user_id: USER },
        fakes(new Error("user_not_found")),
      ),
    ).toEqual({ status: 404, body: { code: "user_not_found" } });
    expect(
      await run(
        { action: "suspend", user_id: USER },
        fakes(new Error("timeout at db.internal:5432")),
      ),
    ).toEqual({ status: 502, body: { code: "unavailable" } });
  });

  it("says so when the action happened but its trail row did not land", async () => {
    const f = fakes();
    f.db.record.mockRejectedValueOnce(new Error("not_recorded"));
    expect(await run({ action: "confirm_email", user_id: USER }, f)).toEqual({
      status: 200,
      body: { ok: true, recorded: false },
    });
  });
});
