import { describe, expect, it } from "vitest";
import { enabledProviders, providers } from "./authProviders";

describe("which doors are open", () => {
  it("offers nothing as open when nothing is configured", () => {
    // The state of the project today: google, azure and saml all disabled.
    // Three buttons that look ready and are not is how a reader concludes the
    // product is broken rather than that a door is not open yet.
    expect(providers(undefined).every((p) => p.closedReason)).toBe(true);
    expect(providers("").every((p) => p.closedReason)).toBe(true);
  });

  it("opens exactly what is named", () => {
    const open = providers("google");
    expect(open.find((p) => p.id === "google")!.closedReason).toBeNull();
    expect(open.find((p) => p.id === "azure")!.closedReason).not.toBeNull();
    expect(open.find((p) => p.id === "sso")!.closedReason).not.toBeNull();
  });

  it("ignores a name it does not know", () => {
    // A typo in an environment variable should not put a door on the page
    // that leads nowhere.
    expect(enabledProviders("google, githbu, ,AZURE")).toEqual(
      new Set(["google", "azure"]),
    );
  });

  it("keeps one order, whatever the configuration says", () => {
    // The row must not reshuffle when a provider is enabled: a control that
    // moves when the backend changes is one the reader has to find again.
    const ids = (raw: string) => providers(raw).map((p) => p.id);
    expect(ids("")).toEqual(["google", "azure", "sso"]);
    expect(ids("sso,azure")).toEqual(["google", "azure", "sso"]);
  });

  it("says why a closed door is closed", () => {
    // "Unavailable" tells the reader nothing about whether to wait or to use
    // the other form.
    for (const p of providers("")) {
      expect(p.closedReason).toMatch(/لم يُفعَّل/);
    }
  });
});
