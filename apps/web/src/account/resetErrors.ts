/**
 * What to tell the person when Supabase refuses a password change. Each
 * code the auth API documents for `updateUser` gets its own sentence; an
 * unknown one is shown with its code, so a report can name it.
 */
import type { Strings } from "../strings";

export type AuthFailure = {
  code?: string;
  status?: number;
  message?: string;
  reasons?: string[];
};

export function describeResetError(error: AuthFailure, S: Strings): string {
  switch (error.code) {
    case "same_password":
      return S.resetSamePassword;
    case "weak_password":
      return S.resetWeak(
        (error.reasons ?? []).map((r) =>
          r === "length"
            ? S.resetRuleLength
            : r === "characters"
              ? S.resetWeakCharacters
              : r === "pwned"
                ? S.resetWeakPwned
                : r,
        ),
      );
    case "reauthentication_not_valid":
    case "reauth_nonce_missing":
      return S.resetCodeWrong;
    case "session_expired":
    case "session_not_found":
    case "bad_jwt":
    case "otp_expired":
      return S.resetLinkExpired;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return S.resetRateLimited;
    default:
      return S.resetFailedCode(
        error.code ?? (error.status ? `http_${error.status}` : "unknown"),
      );
  }
}
