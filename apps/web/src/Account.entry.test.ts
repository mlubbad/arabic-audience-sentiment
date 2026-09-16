/** The way in, rendered.
 *
 * The browser suite runs a build with no Supabase configured, so it never sees
 * this form at all — it sees the "not available in this preview" screen. These
 * assertions therefore live here, where the client can be stood up, rather
 * than in a suite that would quietly pass by never reaching the thing.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ providers: "", isAdmin: false }));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signInWithOAuth: () => Promise.resolve({ error: null }),
    },
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  },
}));

vi.mock("./adminAccess", () => ({
  useIsPlatformAdmin: () => ({ data: shared.isAdmin, isPending: false }),
}));

/** The component reads `window.location.search`, and a server render has no
 *  `window` at all — so stubbing `location` alone left the signup screen
 *  unreachable and the test silently rendered the login screen twice. */
const atUrl = (search: string) =>
  vi.stubGlobal("window", {
    location: { search, origin: "https://example.invalid" },
  });
atUrl("");

async function render() {
  vi.stubEnv("VITE_AUTH_PROVIDERS", shared.providers);
  const { Account } = await import("./Account");
  return renderToStaticMarkup(createElement(Account));
}

beforeEach(() => {
  vi.resetModules();
  shared.providers = "";
  shared.isAdmin = false;
  atUrl("");
});

describe("the sign-in surface", () => {
  it("opens on the log-in screen, not on a form that does both", async () => {
    const html = await render();
    expect(html).toContain("مرحبًا بعودتك");
    // One form with two submits put the way into an existing account and the
    // way to a new one on adjacent buttons — one mis-click apart.
    expect(html).not.toContain(">إنشاء حساب جديد<");
    expect(html).toContain("أنشئ حسابًا");
  });

  it("shows every door, and disables the ones that are shut", async () => {
    const html = await render();
    // None of the three is enabled on the project today: google, azure and
    // saml all read false in its auth config. A button that cannot sign
    // anyone in spends the reader's one moment of intent on an error from a
    // third party, and teaches them the product is broken rather than that
    // this door is not open yet.
    for (const id of ["google", "azure", "sso"]) {
      expect(html, id).toContain(`data-provider="${id}"`);
    }
    // Asserted through the reason, not the attribute: `disabled` is also true
    // for the moment before the session resolves, so it cannot tell "this door
    // is shut" apart from "we do not know who you are yet".
    for (const id of ["google", "azure", "sso"]) {
      expect(html, id).toContain(`id="why-${id}"`);
    }
    // And each says why. "Unavailable" does not tell a reader whether to wait
    // or to use the form above it.
    expect(html.match(/لم يُفعَّل/g) ?? []).toHaveLength(3);
  });

  it("opens a door the configuration opens", async () => {
    shared.providers = "google";
    const html = await render();
    expect(html).toContain('data-provider="google"');
    expect(html).not.toContain('id="why-google"');
    // And leaves the others shut, so the UI cannot get ahead of the backend.
    expect(html).toContain('id="why-azure"');
    expect(html).toContain('id="why-sso"');
  });

  it("never puts two buttons of the same name on one screen", async () => {
    // Flagged by a peer session working in this checkout: the live suite
    // locates controls by role and accessible name, and Playwright's strict
    // mode fails on two matches rather than picking one. The two-screen split
    // creates the risk — "تسجيل الدخول" is the submit on one screen and the
    // switch link on the other — so it is asserted rather than reasoned about.
    const count = (html: string, name: string) =>
      (html.match(new RegExp(`>${name}<`, "g")) ?? []).length;

    const login = await render();
    expect(count(login, "تسجيل الدخول")).toBe(1);
    expect(count(login, "إنشاء حساب جديد")).toBe(0);

    atUrl("?signup=1");
    vi.resetModules();
    const signup = await render();
    expect(count(signup, "إنشاء حساب جديد")).toBe(1);
    expect(count(signup, "تسجيل الدخول")).toBe(1);
  });

  it("offers no retire door to a platform admin", async () => {
    // This suite never resolves a session (the mocked getSession always
    // returns null), so the workspace list itself never renders here either
    // way; this guards the isPending-aware `mayRetire` gate in Account.tsx
    // against a regression that would show it once one exists.
    shared.isAdmin = true;
    const html = await render();
    expect(html).not.toContain("إنهاء المساحة");
  });

  it("claims nothing it cannot show", async () => {
    const html = await render();
    // The screen this was modelled on carries "Trusted by 200,000+ companies
    // in 120 countries" over five customer logos. This product has no
    // customers, so that line would be an invention — and on a product whose
    // argument is that it reports what it measured, a fabricated number on
    // the way in undoes the argument before the reader reaches the data.
    expect(html).not.toMatch(/\d[\d,]{3,}\s*\+?\s*(شركة|عميل|مؤسسة)/);
    expect(html).toContain("لا نعرض عدد عملاء ولا شعارات");
    // What it says instead is a property of the build, and each line is
    // asserted by a test in this repository.
    expect(html).toContain("العزل مفروض");
    expect(html).toContain("معدودة لا مقدَّرة");
  });
});
