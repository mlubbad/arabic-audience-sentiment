// @vitest-environment jsdom
/** The admin page behind `?demo=1`: no session, no admin check, the six
 *  fixture rows on the table, and a lever that goes through the reducer —
 *  a refusal said in the row, a deletion taking its row with it. The fixture
 *  is the real `public/fixtures/admin.json`, served by a stubbed `fetch`.
 *  The live path's gate is the browser suite's (`app-shell.spec.ts`). */
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { ar } from "../strings/ar";
import { fixtureCatalogue } from "../data";

vi.mock("../supabase", () => ({ supabase: null }));
vi.mock("../ui/Toast", () => ({ toast: vi.fn() }));

import { AdminPage } from "./AdminPage";

// A string path, not a `URL`: under jsdom `URL` is the browser's class and
// node's `fs` refuses it.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  path.join(here, "../../public/fixtures/admin.json"),
  "utf8",
);

// Radix's checkbox measures itself; jsdom has no ResizeObserver.
const NativeResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  globalThis.ResizeObserver = NativeResizeObserver;
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/admin?demo=1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.endsWith("/fixtures/admin.json"))
        throw new Error(`unexpected fetch: ${url}`);
      return new Response(fixture, {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const ROW = (n: number) => `admin-row-00000000-0000-4000-8000-00000000000${n}`;

/** Opens workspace n's panel from its row and returns the panel. */
async function openPanel(n: number) {
  const row = await screen.findByTestId(ROW(n));
  await userEvent.click(within(row).getByRole("button", { name: /^إدارة / }));
  return screen.findByTestId("admin-workspace-panel");
}

describe("AdminPage in demo mode", () => {
  it("renders the six rows to a visitor with no session, under the demo eyebrow and lead", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      ar.adminTitle,
    );
    expect(
      screen.getByText(`${ar.adminEyebrow} · ${ar.dashDemoTag}`),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.adminDemoLead)).toBeInTheDocument();
    const table = await screen.findByTestId("admin-workspaces");
    expect(table.tagName).toBe("TABLE");
    expect(within(table).getAllByTestId(/^admin-row-/)).toHaveLength(6);
    expect(screen.queryByTestId("admin-forbidden")).toBeNull();
  });

  it("lists without levers: no form and no delete on any row, an owner on each (review finding 12)", async () => {
    mount();
    const table = await screen.findByTestId("admin-workspaces");
    expect(within(table).queryByTestId("admin-plan-form")).toBeNull();
    expect(within(table).queryByTestId("admin-pack-form")).toBeNull();
    expect(
      within(table).queryByRole("button", { name: ar.adminDelete }),
    ).toBeNull();
    // Two rows share the owner's account; the owner column tells them apart
    // from the customers'.
    expect(screen.getByTestId(ROW(2))).toHaveTextContent(
      "reem@cooking.example",
    );
    expect(screen.getByTestId(ROW(1))).toHaveTextContent(
      "owner@sentiment.internal",
    );
  });

  it("searches by name, by owner email and by id, and says when nothing matches", async () => {
    mount();
    const search = await screen.findByRole("searchbox", {
      name: ar.adminWorkspacesSearch,
    });
    await userEvent.type(search, "nabd@");
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(1);
    expect(screen.getByTestId(ROW(3))).toBeInTheDocument();
    expect(screen.getByText(ar.adminWorkspacesCount(1, 6))).toBeInTheDocument();

    await userEvent.clear(search);
    // Folded like every console search: «إستوديو المدي» finds «استوديو المدى».
    await userEvent.type(search, "إستوديو المدي");
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(1);
    expect(screen.getByTestId(ROW(4))).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "000000000005");
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(1);
    expect(screen.getByTestId(ROW(5))).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "لا شيء بهذا الاسم");
    expect(screen.getByTestId("admin-workspaces-no-match")).toHaveTextContent(
      ar.adminWorkspacesNoMatch,
    );
  });

  it("a plan set over an active Paddle subscription is refused in the panel, as the server refuses it", async () => {
    mount();
    const panel = await openPanel(3);
    const form = within(panel).getByTestId("admin-plan-form");
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminSetPlan }),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      ar.adminPaddleActive,
    );
    // Overridden, it goes through, and the row's plan reads the new name.
    await userEvent.click(
      within(form).getByRole("combobox", { name: ar.adminPlanPicker }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "مؤسسات" }),
    );
    await userEvent.click(
      within(form).getByRole("checkbox", { name: ar.adminOverride }),
    );
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminSetPlan }),
    );
    expect(await within(form).findByText(ar.adminDone)).toBeVisible();
    // The plan by its name, not its key (review finding 17); the list row
    // behind the panel moved with it. Cell 0 is the owner, cell 1 the plan.
    const enterprise = fixtureCatalogue.find((p) => p.key === "enterprise")!;
    const row = screen.getByTestId(ROW(3));
    expect(
      within(row).getAllByRole("cell", { hidden: true })[1],
    ).toHaveTextContent(enterprise.title_ar);
  });

  it("a deleted workspace leaves the list and closes its panel; the billing root refuses", async () => {
    mount();
    const panel = await openPanel(6);
    await userEvent.click(
      within(panel).getByRole("button", { name: ar.adminDelete }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ar.adminDeleteTitle("مساحة بلا خطة"),
    });
    await userEvent.type(
      within(dialog).getByLabelText(ar.adminDeleteTypeName("مساحة بلا خطة")),
      "مساحة بلا خطة",
    );
    const confirm = within(dialog).getByRole("button", {
      name: ar.adminDeleteConfirm,
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId(ROW(6))).toBeNull());
    await waitFor(() =>
      expect(screen.queryByTestId("admin-workspace-panel")).toBeNull(),
    );
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(5);

    const second = await openPanel(1);
    await userEvent.click(
      within(second).getByRole("button", { name: ar.adminDelete }),
    );
    const confirmDialog = await screen.findByRole("dialog", {
      name: ar.adminDeleteTitle("مساحة العمل الشخصية"),
    });
    await userEvent.type(
      within(confirmDialog).getByLabelText(
        ar.adminDeleteTypeName("مساحة العمل الشخصية"),
      ),
      "مساحة العمل الشخصية",
    );
    const confirmRoot = within(confirmDialog).getByRole("button", {
      name: ar.adminDeleteConfirm,
    });
    await waitFor(() => expect(confirmRoot).toBeEnabled());
    await userEvent.click(confirmRoot);
    expect(await within(confirmDialog).findByRole("alert")).toHaveTextContent(
      ar.adminDeleteBillingRoot,
    );
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(5);
  });
});

describe("the admin page's sources", () => {
  // The old-sheet guard for this directory is Task 7's widening of
  // dashboard/noReportCss.test.ts; a copy here would put the strings it
  // forbids into this directory's own grep.
  it("main.tsx loads the page from ./admin/AdminPage", () => {
    const main = readFileSync(path.join(here, "../main.tsx"), "utf8");
    expect(main).toContain('import("./admin/AdminPage")');
    expect(main).not.toContain('import("./AdminPage")');
  });
});
