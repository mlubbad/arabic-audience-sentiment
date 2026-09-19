/** The owner's workspace card, rendered.
 *
 * The browser suite runs with no Supabase and never signs in, so the only
 * screen an owner actually uses — their workspaces, with the three steps and
 * the channel line — is asserted here, on the presentational card, with rows
 * handed in as the page would hand them.
 *
 * Static markup: what the card says and which doors it offers per channel
 * state. What each door does when pressed, and the two questions that open
 * in a dialog (a portal, which renders nothing to a string), are driven in
 * `account/WorkspaceCard.test.tsx`.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { resetLocale, setLocale } from "./locale";
import { loadStrings } from "./strings";
import { WorkspaceCard, type ChannelRow } from "./account/WorkspaceCard";
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

// The catalogue door is a router `Link`, so the card renders inside a router.
function render(over: Partial<Parameters<typeof WorkspaceCard>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/account" },
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
    ),
  );
}

describe("a workspace card", () => {
  it("names the channel by its title, then its handle, and labels a bare id as an id", () => {
    expect(render({ channel: connected })).toContain(
      "<bdi>قناة الأخبار الرسمية</bdi>",
    );
    expect(render({ channel: { ...connected, title: null } })).toContain(
      "<bdi>@akhbar</bdi>",
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
    // And the visitor's list is the same list, not a second copy of it. It
    // is drawn by the signed-out entry (`account/AuthEntry.tsx`) since
    // phase 5 cut that screen out of `Account.tsx`.
    const entry = readFileSync(
      new URL("./account/AuthEntry.tsx", import.meta.url),
      "utf8",
    );
    expect(entry).toContain("setupSteps.map(");
    for (const step of setupSteps) expect(entry).not.toContain(ar[step.title]);
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

  it("offers the connect and relink doors directly without an intermediate warning", () => {
    // Not connected yet: the connect button renders directly.
    const notConnected = render({ hasClient: true, channel: null });
    expect(notConnected).toContain(`data-testid="connect-${W1}"`);
    expect(notConnected).toContain(ar.connectChannel);

    // The relink door is offered when a connected channel has no stored name.
    const relink = render({
      channel: { ...connected, handle: null, title: null },
    });
    expect(relink).toContain(`data-testid="relink-${W1}"`);
    expect(relink).toContain(ar.relinkForName);
  });

  it("offers to disconnect exactly while a channel is connected, and asks first", () => {
    // Connected: the way out sits beside the way to the catalogue, and it is
    // a two-step door — the first press asks, the second disconnects, in a
    // dialog (driven in `account/WorkspaceCard.test.tsx`; a portal renders
    // nothing to static markup).
    const ask = render({ channel: connected });
    expect(ask).toContain(`data-testid="disconnect-${W1}"`);
    expect(ask).toContain(ar.disconnectChannel);
    expect(ask).not.toContain(ar.disconnectConfirm);
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
    const card = render({ channel: connected, onRetire: () => {} });
    expect(card).toContain(`data-testid="rename-${W1}"`);
    expect(card).toContain(ar.renameWorkspace);
    expect(card).toContain(`data-testid="retire-${W1}"`);
    expect(card).toContain(ar.retireWorkspace);
    // The question itself opens in a dialog — driven, not rendered here.
    expect(card).not.toContain(ar.retireConfirm);
    // Renaming is a form with the current name in it.
    const renaming = render({
      channel: connected,
      renaming: true,
      onRetire: () => {},
    });
    expect(renaming).toContain(`data-testid="rename-form-${W1}"`);
    expect(renaming).toContain('value="قناة الأخبار"');
    // Retiring is not offered while the door is only for owners; the card
    // does not know roles, so the page decides — but it is offered without a
    // channel too: a workspace with nothing connected can still be handed over.
    expect(render({ channel: null, onRetire: () => {} })).toContain(
      `data-testid="retire-${W1}"`,
    );
  });

  it("offers no retire door at all when the caller may not retire", () => {
    const card = render({ onRetire: undefined });
    expect(card).not.toContain(`data-testid="retire-${W1}"`);
    expect(card).not.toContain(ar.retireWorkspace);
    // Rename is unaffected.
    expect(card).toContain(ar.renameWorkspace);
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
