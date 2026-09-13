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
export type AuthAction = "signin" | "signup";

const MESSAGES: Record<string, string> = {
  // Supabase returns this for both a wrong password and an address that was
  // never registered, and deliberately so: telling them apart would let anyone
  // test whether a given person has an account here. The wording therefore
  // covers both without claiming which one happened.
  invalid_credentials:
    "البريد الإلكتروني أو كلمة المرور غير صحيحة، أو لا يوجد حساب بهذا البريد. لإنشاء حساب جديد اختر «إنشاء حساب».",
  email_not_confirmed:
    "لم يُفعَّل هذا الحساب بعد. افتح رابط التأكيد المُرسَل إلى بريدك، ثم سجّل الدخول.",
  user_already_exists:
    "هذا البريد مسجَّل بالفعل. اختر «تسجيل الدخول» بدل إنشاء حساب.",
  weak_password: "كلمة المرور ضعيفة. استخدم ثمانية أحرف على الأقل.",
  email_address_invalid: "صيغة البريد الإلكتروني غير مقبولة.",
  email_address_not_authorized:
    "هذا البريد غير مصرَّح له بالتسجيل في هذا المشروع.",
  signup_disabled: "إنشاء الحسابات معطَّل في هذا المشروع.",
  over_email_send_rate_limit:
    "أُرسلت رسائل كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة.",
  over_request_rate_limit:
    "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.",
  validation_failed: "البيانات المُدخلة غير مكتملة أو غير صالحة.",
};

/** Reads the code Supabase sends, falling back to the HTTP status. */
export function authErrorCode(error: unknown): string {
  const e = error as { code?: string; status?: number };
  if (typeof e?.code === "string" && e.code) return e.code;
  return e?.status ? `http_${e.status}` : "unknown_error";
}

export function authErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  return (
    MESSAGES[code] ??
    // No server text: it can quote the endpoint, and the endpoint carries a key.
    `تعذر إتمام الطلب. رمز الخطأ: ${code}`
  );
}

/**
 * What to say when it worked. Signing up does not sign you in while the project
 * requires email confirmation, and saying "done" there would be a lie the
 * person only discovers when the dashboard is still empty.
 */
export function authSuccessMessage(
  action: AuthAction,
  hasSession: boolean,
): string {
  if (action === "signin" || hasSession) return "تم تسجيل الدخول.";
  return "أُنشئ الحساب. افتح رابط التأكيد المُرسَل إلى بريدك لتفعيله، ثم سجّل الدخول.";
}
