/**
 * Starting a YouTube connection from the browser.
 *
 * The browser's whole part is: ask our function for a URL, and go there. It
 * never sees the verifier, never chooses the redirect, and never learns the
 * client secret — those live on the server, which is the point of doing the
 * exchange there.
 *
 * Split out as a plain function so the states that are not "it worked" can be
 * tested: no session, a workspace the user does not belong to, a project with
 * OAuth unconfigured, and a network that is simply down.
 */
import { supabase } from "./supabase";

export type ConnectOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

const MESSAGES: Record<string, string> = {
  unauthenticated: "سجّل الدخول أولًا لربط قناة.",
  forbidden: "لا تملك صلاحية ربط قناة في مساحة العمل هذه.",
  invalid_client: "مساحة العمل هذه بلا عميل. أنشئ مساحة عمل جديدة.",
  oauth_not_configured: "ربط يوتيوب غير مهيّأ على هذا الخادم.",
  invalid_request: "بيانات الطلب ناقصة.",
};

export async function beginConnect(
  workspaceId: string,
  clientId: string,
): Promise<ConnectOutcome> {
  if (!supabase)
    return { kind: "error", message: MESSAGES.oauth_not_configured };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { kind: "error", message: MESSAGES.unauthenticated };

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          client_id: clientId,
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      url?: string;
      code?: string;
    };
    if (!response.ok || !body.url)
      return {
        kind: "error",
        // A code we do not recognise is shown as a code, never as server text.
        message:
          MESSAGES[body.code ?? ""] ??
          `تعذر بدء الربط. رمز الخطأ: ${body.code ?? response.status}`,
      };
    return { kind: "redirect", url: body.url };
  } catch {
    return { kind: "error", message: "تعذر الاتصال بالخدمة. حاول مجدداً." };
  }
}
