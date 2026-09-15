/** The owner's workspace card, rendered.
 *
 * The browser suite runs with no Supabase and never signs in, so the only
 * screen an owner actually uses — their workspaces, with the three steps and
 * the channel line — is asserted here, on the presentational card, with rows
 * handed in as the page would hand them.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { resetLocale, setLocale } from "./locale";
import { loadStrings } from "./strings";
import { WorkspaceCard, type ChannelRow } from "./WorkspaceCard";
import { setupSteps } from "./setup";

const W1 = "11111111-1111-4111-8111-111111111111";

const connected: ChannelRow = {
  workspace_id: W1,
  channel_id: "ch1",
  status: "connected",
  external_channel_id: "UCxxxxxxxxxxxxxxxxxxxxxx",
  handle: "@akhbar",
  title: "قناة الأخبار الرسمية",
};

function render(over: Partial<Parameters<typeof WorkspaceCard>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(WorkspaceCard, {
      workspace: { id: W1, name: "قناة الأخبار" },
      hasClient: true,
      channel: null,
      latestJob: null,
      pending: false,
      feedback: null,
      onSync: () => {},
      onConnect: () => {},
      ...over,
    }),
  );
}

describe("a workspace card", () => {
  it("names the channel by its title, then its handle, and labels a bare id as an id", () => {
    expect(render({ channel: connected })).toContain(
      "<b>قناة الأخبار الرسمية</b>",
    );
    expect(render({ channel: { ...connected, title: null } })).toContain(
      "<b>@akhbar</b>",
    );
    // The id was printed as though it were a name. It still appears — it is
    // the only identity there is when no name is stored — but as an id.
    const bare = render({
      channel: { ...connected, handle: null, title: null },
    });
    expect(bare).toContain("<code>UCxxxxxxxxxxxxxxxxxxxxxx</code>");
    expect(bare).toContain("المعرّف");
    expect(bare).not.toContain("قناة مرتبطة: UC");
  });

  it("says what a seeded public channel is, rather than that it needs re-linking", () => {
    const html = render({
      channel: {
        ...connected,
        status: "public_unverified",
        handle: null,
        title: null,
      },
    });
    expect(html).toContain("قناة عامة بلا إذن بعد");
    expect(html).not.toContain("إعادة ربط (");
    expect(html).toContain(`data-testid="connect-${W1}"`);
  });

  it("places the workspace on the three steps from what the page loaded", () => {
    // Connected, newest job failed → step three needs attention, nothing is
    // "next" because the reader's move is on the operations page.
    const failed = render({
      channel: connected,
      latestJob: { workspace_id: W1, status: "failed", created_at: "" },
    });
    expect(failed).toContain('data-status="done"');
    expect(failed).toContain('data-status="attention"');
    expect(failed).toContain("آخر محاولة لم تكتمل");
    expect(failed).not.toContain('aria-current="step"');
    expect(failed).toContain(`data-testid="sync-${W1}"`);
    // No channel → connecting is the current step; collecting waits.
    const fresh = render();
    expect(fresh).toContain('data-status="next"');
    expect(fresh).toContain('aria-current="step"');
    expect(fresh).toContain('data-status="later"');
  });

  it("shows the visitor's three sentences, in order, to the owner too", () => {
    const html = render();
    const positions = setupSteps.map((s) => html.indexOf(ar[s.title]));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // And the visitor's list is the same list, not a second copy of it.
    const account = readFileSync(
      new URL("./Account.tsx", import.meta.url),
      "utf8",
    );
    expect(account).toContain("setupSteps.map(");
    for (const step of setupSteps)
      expect(account).not.toContain(ar[step.title]);
  });

  it("offers the way back through consent exactly while no name is stored", () => {
    // Connected before the callback asked for a name: the only button was
    // "collect", and there was no way to store the name short of the grant
    // lapsing on its own.
    const unnamed = render({
      channel: { ...connected, handle: null, title: null },
    });
    expect(unnamed).toContain(`data-testid="relink-${W1}"`);
    expect(unnamed).toContain(`data-testid="sync-${W1}"`);
    // Named, by either name: nothing to fill, no button.
    expect(render({ channel: connected })).not.toContain("relink-");
    expect(render({ channel: { ...connected, title: null } })).not.toContain(
      "relink-",
    );
    // Not connected: the ordinary connect button is the way in, not this one.
    expect(
      render({
        channel: {
          ...connected,
          status: "reconnect_required",
          handle: null,
          title: null,
        },
      }),
    ).not.toContain("relink-");
    // No client: the server would refuse, so no button that always fails.
    expect(
      render({
        hasClient: false,
        channel: { ...connected, handle: null, title: null },
      }),
    ).not.toContain("relink-");
  });

  it("speaks English when the interface does, from the same rows", async () => {
    await loadStrings("en");
    setLocale("en");
    try {
      const html = render({
        channel: { ...connected, handle: null, title: null },
        latestJob: { workspace_id: W1, status: "queued", created_at: "" },
      });
      expect(html).toContain("Connected channel: ");
      expect(html).toContain("In progress");
      expect(html).toContain("Reconnect to store the channel");
      // The workspace's own name is data and stays as the owner wrote it;
      // everything the interface says around it is English.
      expect(html.replace("قناة الأخبار", "")).not.toMatch(/[\u0600-\u06FF]/);
    } finally {
      resetLocale();
    }
  });

  it("carries its own feedback inside the card, after its action", () => {
    const html = render({
      channel: connected,
      feedback: createElement("p", { className: "account-feedback" }, "قائم"),
    });
    const button = html.indexOf(`data-testid="sync-${W1}"`);
    const note = html.indexOf("account-feedback");
    expect(button).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(button);
    expect(html.indexOf("</li>", note)).toBeGreaterThan(note);
    expect(html.endsWith("</li>")).toBe(true);
  });
});
