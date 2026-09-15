/**
 * What to tell someone when signing in or up fails.
 *
 * Every failure used to collapse into one sentence — "check your data and
 * account settings" — which cannot distinguish a wrong password from an
 * unconfirmed account from a project that has signup switched off. The person
 * reading it has no way to know what to do next, and neither does whoever they
 * ask for help.
 *
 * Only known codes are given a sentence. An unrecognised failure shows its code
 * and nothing else, for the same reason the worker gateway returns a code and
 * no message: a server error can carry a URL, and a URL can carry a key.
 */
import type { StringKey, Strings } from "./strings";

export type AuthAction = "signin" | "signup";

/** Which sentence each code gets. The sentences live in `strings/`; this is
 *  only the map from Supabase's vocabulary to ours. */
const MESSAGES: Record<string, StringKey> = {
  // Supabase returns this for both a wrong password and an address that was
  // never registered, and deliberately so: telling them apart would let anyone
  // test whether a given person has an account here. The wording therefore
  // covers both without claiming which one happened.
  invalid_credentials: "authInvalidCredentials",
  email_not_confirmed: "authEmailNotConfirmed",
  user_already_exists: "authUserExists",
  weak_password: "authWeakPassword",
  email_address_invalid: "authEmailInvalid",
  email_address_not_authorized: "authEmailNotAuthorized",
  signup_disabled: "authSignupDisabled",
  over_email_send_rate_limit: "authEmailRateLimit",
  over_request_rate_limit: "authRequestRateLimit",
  validation_failed: "authValidationFailed",
};

/** Reads the code Supabase sends, falling back to the HTTP status. */
export function authErrorCode(error: unknown): string {
  const e = error as { code?: string; status?: number };
  if (typeof e?.code === "string" && e.code) return e.code;
  return e?.status ? `http_${e.status}` : "unknown_error";
}

export function authErrorMessage(error: unknown, S: Strings): string {
  const code = authErrorCode(error);
  const key = MESSAGES[code];
  // No server text: it can quote the endpoint, and the endpoint carries a key.
  return key ? S[key] : S.authUnknownError(code);
}

/**
 * What to say when it worked. Signing up does not sign you in while the project
 * requires email confirmation, and saying "done" there would be a lie the
 * person only discovers when the dashboard is still empty.
 */
export function authSuccessMessage(
  action: AuthAction,
  hasSession: boolean,
  S: Strings,
): string {
  if (action === "signin" || hasSession) return S.authSignedIn;
  return S.authSignedUp;
}
