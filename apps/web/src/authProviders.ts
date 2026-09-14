/**
 * Which ways in actually work.
 *
 * A sign-in button that cannot sign anyone in is worse than no button: the
 * reader spends their one moment of intent on it, gets an error from a
 * provider they have never heard of, and learns that this product is broken
 * rather than that this door is not open yet. The account page already applies
 * that rule to the channel connection — "a button that always fails is worse
 * than no button" — and it applies here for the same reason.
 *
 * So the set is configured, not assumed. `VITE_AUTH_PROVIDERS` lists what the
 * Supabase project has enabled; anything absent is rendered as a door that
 * exists and is not open yet, which is the true thing to say about it. Turning
 * one on is a provider's credentials in the project plus its name here — the
 * UI needs no other change, and cannot get ahead of the backend.
 *
 * As of this writing the project has none of the three enabled
 * (`external_google_enabled`, `external_azure_enabled`, `saml_enabled` all
 * false), so all three render closed. That is not a placeholder: it is what is
 * true, and it stops being true the moment the configuration changes.
 */
export type ProviderId = "google" | "azure" | "sso";

export type Provider = {
  id: ProviderId;
  /** What the reader calls it, not what the API calls it. */
  label: string;
  /** Why it is closed, said plainly. Null when it is open. */
  closedReason: string | null;
};

/** The order they are offered in. Familiarity first, then the corporate door. */
const ORDER: { id: ProviderId; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "azure", label: "Microsoft" },
  { id: "sso", label: "SSO" },
];

const CLOSED: Record<ProviderId, string> = {
  google: "الدخول عبر Google لم يُفعَّل بعد على هذا المشروع.",
  azure: "الدخول عبر Microsoft لم يُفعَّل بعد على هذا المشروع.",
  sso: "الدخول الموحَّد للمؤسسات (SAML) لم يُفعَّل بعد.",
};

/**
 * Parsed once from configuration. Unknown names are dropped rather than shown:
 * a typo in an environment variable should not put a door on the page that
 * leads nowhere.
 */
export function enabledProviders(raw: string | undefined): Set<ProviderId> {
  const known = new Set(ORDER.map((p) => p.id));
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is ProviderId => known.has(s as ProviderId)),
  );
}

export function providers(raw: string | undefined): Provider[] {
  const on = enabledProviders(raw);
  return ORDER.map(({ id, label }) => ({
    id,
    label,
    closedReason: on.has(id) ? null : CLOSED[id],
  }));
}

/**
 * Supabase's own name for the provider, which is not always the reader's.
 * SSO is not an OAuth provider at all — it is a separate call taking a domain
 * — so it has no mapping here and is handled by its own branch.
 */
export const supabaseProvider: Record<"google" | "azure", "google" | "azure"> =
  {
    google: "google",
    azure: "azure",
  };
