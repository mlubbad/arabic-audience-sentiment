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
    // "next" because the reader's move is on the operations page. `sync-<id>`
    // is that move: once a link to the catalogue (`/sync?ws=<id>`), no longer
    // a button that enqueued a whole-channel job from here.
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

  it("asks before it leaves for Google, on both the connect and the relink door", () => {
    // Not connected yet: the connect button asks first; the redirect itself
    // never fires from a bare render (onConnect only ever receives the step).
    const asking = render({ hasClient: true, channel: null });
    expect(asking).toContain(`data-testid="connect-${W1}"`);
    expect(asking).not.toContain(ar.connectAboutGoogle);
    const confirmingConnect = render({
      hasClient: true,
      channel: null,
      confirmingConnect: true,
    });
    expect(confirmingConnect).toContain(ar.connectAboutGoogle);
    expect(confirmingConnect).toContain(ar.connectContinueToGoogle);
    expect(confirmingConnect).toContain(ar.renameCancel);
    // The relink door goes through the same question — it is the same
    // redirect, and the same two Google warnings wait on the other side.
    // The relink door hides behind the same question, and reappears once
    // the reader steps back from it.
    const relinkAsking = render({
      channel: { ...connected, handle: null, title: null },
    });
    expect(relinkAsking).toContain(`data-testid="relink-${W1}"`);
    const relinking = render({
      channel: { ...connected, handle: null, title: null },
      confirmingConnect: true,
    });
    expect(relinking).not.toContain("relink-");
    expect(relinking).toContain(ar.connectAboutGoogle);
  });

  it("offers to disconnect exactly while a channel is connected, and asks first", () => {
    // Connected: the way out sits beside the way to the catalogue, and it is
    // a two-step door — the first press asks, the second disconnects.
    const ask = render({ channel: connected });
    expect(ask).toContain(`data-testid="disconnect-${W1}"`);
    expect(ask).toContain(ar.disconnectChannel);
    expect(ask).not.toContain(ar.disconnectConfirm);
    const confirming = render({
      channel: connected,
      confirmingDisconnect: true,
    });
    expect(confirming).toContain(ar.disconnectConfirm);
    expect(confirming).toContain(ar.disconnectKeep);
    // Anything but connected: nothing to disconnect.
    expect(
      render({ channel: { ...connected, status: "disconnected" } }),
    ).not.toContain("disconnect-");
    expect(
      render({ channel: { ...connected, status: "reconnect_required" } }),
    ).not.toContain("disconnect-");
    expect(render({ channel: null })).not.toContain("disconnect-");
  });

  it("offers to rename, and to retire — the retire door asks first and says what stays", () => {
    const card = render({ channel: connected });
    expect(card).toContain(`data-testid="rename-${W1}"`);
    expect(card).toContain(ar.renameWorkspace);
    expect(card).toContain(`data-testid="retire-${W1}"`);
    expect(card).toContain(ar.retireWorkspace);
    expect(card).not.toContain(ar.retireConfirm);
    const asking = render({ channel: connected, confirmingRetire: true });
    expect(asking).toContain(ar.retireConfirm);
    expect(asking).toContain(`data-testid="retire-confirm-${W1}"`);
    // Renaming is a form with the current name in it.
    const renaming = render({ channel: connected, renaming: true });
    expect(renaming).toContain(`data-testid="rename-form-${W1}"`);
    expect(renaming).toContain('value="قناة الأخبار"');
    // Retiring is not offered while the door is only for owners; the card
    // does not know roles, so the page decides — but it is offered without a
    // channel too: a workspace with nothing connected can still be handed over.
    expect(render({ channel: null })).toContain(`data-testid="retire-${W1}"`);
  });

  it("carries its own feedback inside the card, after its action", () => {
    // `sync-<id>` is the catalogue link now, not a request button; the note
    // still belongs after it, inside the card.
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
