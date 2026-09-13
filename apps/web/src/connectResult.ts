/**
 * What to tell someone when they come back from Google.
 *
 * The callback sends a code, never a sentence: a code is an enum we translate
 * here, while a message could carry a Google error body, and those quote the
 * request back. The translation lives in the app because the app is where the
 * person is, and because an unrecognised code must still say something useful.
 */
export type ConnectResult = {
  tone: "success" | "notice" | "error";
  heading: string;
  detail: string;
  /** What the person can actually do next, when there is something. */
  action: "retry" | "console" | null;
};

const FAILURES: Record<
  string,
  { detail: string; action: ConnectResult["action"] }
> = {
  declined: {
    detail:
      "لم تُمنح الصلاحية، فلم يُربط شيء ولم يُحفظ أي رمز. يمكنك المحاولة مرة أخرى متى شئت.",
    action: "retry",
  },
  youtube_api_not_enabled: {
    detail:
      "واجهة YouTube Data API v3 غير مفعّلة في مشروع Google Cloud الخاص بك. فعّلها ثم أعد المحاولة؛ الموافقة التي منحتها الآن لا تكفي وحدها.",
    action: "console",
  },
  youtube_scope_missing: {
    detail:
      "الصلاحية الممنوحة لا تشمل قراءة بيانات يوتيوب. أعد المحاولة واقبل الطلب كاملًا.",
    action: "retry",
  },
  youtube_quota_exceeded: {
    detail: "استُهلكت حصة يوتيوب اليومية. تعود غدًا، وعندها أعد المحاولة.",
    action: null,
  },
  no_channel_on_account: {
    detail:
      "لا توجد قناة يوتيوب على هذا الحساب. سجّل الدخول بحساب Google الذي يملك القناة.",
    action: "retry",
  },
  ambiguous_channel: {
    detail:
      "هذا الحساب يملك أكثر من قناة، ولا نختار نيابة عنك. اختر حساب قناة واحدة.",
    action: "retry",
  },
  no_refresh_token: {
    detail:
      "لم تمنح Google صلاحية متجددة، والجمع يحتاجها ليستمر بعد إغلاق المتصفح. أعد المحاولة واقبل الطلب كاملًا.",
    action: "retry",
  },
  invalid_state: {
    detail:
      "انتهت صلاحية طلب الربط أو استُخدم من قبل. ابدأ من جديد؛ هذا القيد هو ما يمنع إعادة استخدام رابط قديم.",
    action: "retry",
  },
  invalid_callback: {
    detail: "الرابط الذي عدت به غير مكتمل. ابدأ الربط من جديد.",
    action: "retry",
  },
  channel_already_connected: {
    detail: "هذه القناة مرتبطة بمساحة عمل أخرى. افصلها هناك أولًا.",
    action: null,
  },
};

export function connectResult(params: URLSearchParams): ConnectResult {
  if (params.get("status") === "connected") {
    const channel = params.get("channel");
    return {
      tone: "success",
      heading: "تم ربط القناة",
      detail: channel
        ? `القناة متصلة الآن. سيبدأ الجمع في أول مزامنة (${channel}).`
        : "القناة متصلة الآن. سيبدأ الجمع في أول مزامنة.",
      action: null,
    };
  }
  const code = params.get("code") ?? "";
  const known = FAILURES[code];
  if (known)
    return {
      // Declining is a choice, not a failure, and should not be coloured as one.
      tone: code === "declined" ? "notice" : "error",
      heading: code === "declined" ? "لم يكتمل الربط" : "تعذر إتمام الربط",
      detail: known.detail,
      action: known.action,
    };
  return {
    tone: "error",
    heading: "تعذر إتمام الربط",
    // The code and nothing else: it is diagnosable without being server text.
    detail: `تعذر إتمام الطلب. رمز الخطأ: ${code || "unknown"}`,
    action: "retry",
  };
}
