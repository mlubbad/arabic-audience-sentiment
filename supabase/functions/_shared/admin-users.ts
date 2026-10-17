/**
 * The account file's actions that need the auth admin API (owner decision,
 * 2026-10-09): a reset link the owner hands over, suspension and its
 * lifting, a manual email confirmation, and an email change.
 *
 * Who may ask is the database's answer, not this handler's: `target` runs
 * `admin_user_target` with the caller's own token, and that function answers
 * only a platform admin. It also says whether the person is the caller or
 * another admin; neither is ever suspended, and another admin's account is
 * never handed a sign-in link, a new email or a confirmation (owner console
 * review, 2026-10-13: one admin could otherwise take over another, or the
 * owner). Every action that happened is
 * then recorded through `admin_record_user_action`, again as the caller.
 *
 * Pure, with the database and the auth admin API injected, so it is tested
 * without a project, the same shape as `billing-portal.ts`. Neither the
 * driver's nor Supabase Auth's error text is ever repeated to the caller.
 */

export type AdminUserActionName =
  "recovery_link" | "suspend" | "unsuspend" | "confirm_email" | "change_email";

export type Target = {
  email: string | null;
  is_admin: boolean;
  is_self: boolean;
};

export interface AdminUsersDb {
  /** `admin_user_target`; throws with `message` `forbidden` or
   *  `user_not_found` for those refusals. */
  target(userId: string): Promise<Target>;
  /** `admin_record_user_action`. */
  record(userId: string, action: string): Promise<void>;
}

export type AuthAttributes = {
  ban_duration?: string;
  email_confirm?: boolean;
  email?: string;
};

export interface AuthAdmin {
  /** A recovery link for this email, landing on `redirectTo`. */
  recoveryLink(email: string, redirectTo: string): Promise<string>;
  /** `auth.admin.updateUserById`. Throws what Supabase Auth threw. */
  update(userId: string, attributes: AuthAttributes): Promise<void>;
}

export type AdminUsersOutcome =
  | { status: 200; body: { ok: true; recorded: boolean; link?: string } }
  | { status: 400; body: { code: "invalid_request" | "invalid_origin" } }
  | { status: 403; body: { code: "forbidden" } }
  | { status: 404; body: { code: "user_not_found" } }
  | {
      status: 409;
      body: {
        code:
          | "cannot_suspend_admin"
          | "cannot_act_on_admin"
          | "no_email"
          | "email_taken";
      };
    }
  | { status: 502; body: { code: "unavailable" } };

/** A hundred years: Supabase Auth's own example of a ban that does not end
 *  by itself. Lifted with `none`. */
export const SUSPEND_FOR = "876000h";

export const RESET_PATH = "/reset-password";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS: readonly AdminUserActionName[] = [
  "recovery_link",
  "suspend",
  "unsuspend",
  "confirm_email",
  "change_email",
];
const RECORDED: Record<AdminUserActionName, string> = {
  recovery_link: "password_link_created",
  suspend: "user_suspended",
  unsuspend: "user_unsuspended",
  confirm_email: "email_confirmed",
  change_email: "email_changed",
};

const message = (error: unknown) =>
  (error as { message?: unknown } | undefined)?.message;

/** Supabase Auth's answer for an address another account already holds. */
const isEmailTaken = (error: unknown) => {
  const e = error as { code?: unknown; message?: unknown } | undefined;
  return (
    e?.code === "email_exists" ||
    (typeof e?.message === "string" &&
      /already (been )?registered|already exists/i.test(e.message))
  );
};

/**
 * `origin` is the request's `Origin` header; a link is only ever made to land
 * on one of the app's own allowed origins.
 */
export async function adminUserAction(
  body: unknown,
  origin: string | null,
  allowedOrigins: string[],
  db: AdminUsersDb,
  auth: AuthAdmin,
): Promise<AdminUsersOutcome> {
  const b = (body ?? {}) as {
    action?: unknown;
    user_id?: unknown;
    email?: unknown;
  };
  const action = ACTIONS.find((a) => a === b.action);
  if (!action || typeof b.user_id !== "string" || !UUID.test(b.user_id))
    return { status: 400, body: { code: "invalid_request" } };
  const userId = b.user_id;

  let newEmail = "";
  if (action === "change_email") {
    newEmail = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (newEmail.length > 254 || !EMAIL.test(newEmail))
      return { status: 400, body: { code: "invalid_request" } };
  }
  if (
    action === "recovery_link" &&
    (!origin || !allowedOrigins.includes(origin))
  )
    return { status: 400, body: { code: "invalid_origin" } };

  let target: Target;
  try {
    target = await db.target(userId);
  } catch (error) {
    if (message(error) === "forbidden")
      return { status: 403, body: { code: "forbidden" } };
    if (message(error) === "user_not_found")
      return { status: 404, body: { code: "user_not_found" } };
    return { status: 502, body: { code: "unavailable" } };
  }

  if (action === "suspend" && (target.is_self || target.is_admin))
    return { status: 409, body: { code: "cannot_suspend_admin" } };
  // A link, a new address or a confirmation on another admin's account is a
  // way into it; their own account page is where they change those.
  if (
    (action === "recovery_link" ||
      action === "change_email" ||
      action === "confirm_email") &&
    target.is_admin &&
    !target.is_self
  )
    return { status: 409, body: { code: "cannot_act_on_admin" } };
  if (action === "recovery_link" && !target.email)
    return { status: 409, body: { code: "no_email" } };

  let link: string | undefined;
  try {
    if (action === "recovery_link")
      link = await auth.recoveryLink(target.email!, `${origin}${RESET_PATH}`);
    else if (action === "suspend")
      await auth.update(userId, { ban_duration: SUSPEND_FOR });
    else if (action === "unsuspend")
      await auth.update(userId, { ban_duration: "none" });
    else if (action === "confirm_email")
      await auth.update(userId, { email_confirm: true });
    // The owner typed the new address twice; it is theirs to vouch for, so
    // it is marked confirmed rather than left waiting on a mail.
    else await auth.update(userId, { email: newEmail, email_confirm: true });
  } catch (error) {
    if (action === "change_email" && isEmailTaken(error))
      return { status: 409, body: { code: "email_taken" } };
    return { status: 502, body: { code: "unavailable" } };
  }

  // The action happened; a trail row that failed to land does not undo it,
  // and the caller is told which it was.
  let recorded = true;
  try {
    await db.record(userId, RECORDED[action]);
  } catch {
    recorded = false;
  }
  return {
    status: 200,
    body: link ? { ok: true, recorded, link } : { ok: true, recorded },
  };
}
