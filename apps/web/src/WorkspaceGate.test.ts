/** The four questions on the way into a signed-in page, asked once.
 *
 * The browser suite runs signed out, so it never reaches any of these states.
 * They are rendered here instead, where a state can be forced.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceGate, type GateWords } from "./WorkspaceGate";
import type { WorkspaceState } from "./workspace";

const words: GateWords = {
  eyebrow: "نظرة عامة",
  chooseTitle: "أي مساحة عمل؟",
  chooseLead: "لكل مساحة بياناتها.",
  chooseTestId: "ws-choose",
};
const two: WorkspaceState = {
  kind: "choose",
  options: [
    { id: "a", name: "مساحة أ" },
    { id: "b", name: "مساحة ب" },
  ],
};
const ready: WorkspaceState = {
  kind: "ready",
  id: "a",
  name: "مساحة أ",
  options: [{ id: "a", name: "مساحة أ" }],
};

function render(over: Partial<Parameters<typeof WorkspaceGate>[0]>) {
  return renderToStaticMarkup(
    createElement(WorkspaceGate, {
      sessionLoading: false,
      live: true,
      workspacesLoading: false,
      workspacesFailed: false,
      place: ready,
      chosen: null,
      onChoose: () => {},
      words,
      children: createElement("main", { id: "body" }, "المحتوى"),
      ...over,
    } as Parameters<typeof WorkspaceGate>[0] & object),
  );
}

describe("the workspace gate", () => {
  it("asks in the same box on every page, with the page's own words", () => {
    const html = render({ place: two });
    expect(html).toContain('class="app-state"');
    expect(html).toContain('data-testid="ws-choose"');
    expect(html).toContain("نظرة عامة");
    expect(html).toContain("<h1>أي مساحة عمل؟</h1>");
    expect(html).toContain("مساحة أ");
    expect(html).toContain("مساحة ب");
    expect(html).not.toContain('id="body"');
  });

  it("lets a ready page through, and a visitor or the fixture through untouched", () => {
    expect(render({})).toContain('id="body"');
    expect(render({ live: false, place: two })).toContain('id="body"');
    expect(render({ live: false, place: { kind: "needs_auth" } })).toContain(
      'id="body"',
    );
  });

  it("says loading, failed and empty in that box too, and failed is an alert", () => {
    expect(render({ sessionLoading: true })).toContain('role="status"');
    expect(render({ workspacesLoading: true })).toContain(
      "جارٍ تحميل مساحات العمل",
    );
    const failed = render({ workspacesFailed: true });
    expect(failed).toContain('role="alert"');
    // The wording that survived the merge is the one that said more: it tells
    // the reader that demo data will not be shown in place of theirs.
    expect(failed).toContain("لا يمكن عرض بيانات تجربة");
    const none = render({ place: { kind: "no_workspaces" } });
    expect(none).toContain("لا توجد مساحة عمل لهذا الحساب بعد");
    expect(none).toContain('href="/account"');
  });

  it("is the only place the question is asked", () => {
    // The box used to be written twice. Neither page may grow its own again:
    // the chooser's one distinctive line is the empty option, and it belongs
    // to this file alone.
    for (const page of ["dashboard/Dashboard.tsx", "ops/Sync.tsx"]) {
      const src = readFileSync(new URL(`./${page}`, import.meta.url), "utf8");
      expect(src, page).toContain("<WorkspaceGate");
      expect(src, page).not.toContain("— اختر —");
    }
  });
});
