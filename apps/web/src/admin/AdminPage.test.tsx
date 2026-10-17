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

  it("a plan set over an active Paddle subscription is refused in the row, as the server refuses it", async () => {
    mount();
    const row = await screen.findByTestId(
      "admin-row-00000000-0000-4000-8000-000000000003",
    );
    const form = within(row).getByTestId("admin-plan-form");
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminSetPlan }),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      ar.adminPaddleActive,
    );
    // Overridden, it goes through, and the row's plan reads the new key.
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
    // The plan by its name, not its key (review finding 17).
    const enterprise = fixtureCatalogue.find((p) => p.key === "enterprise")!;
    expect(within(row).getAllByRole("cell")[0]).toHaveTextContent(
      enterprise.title_ar,
    );
  });

  it("a deleted workspace leaves the table; the billing root refuses", async () => {
    mount();
    const gone = await screen.findByTestId(
      "admin-row-00000000-0000-4000-8000-000000000006",
    );
    await userEvent.click(
      within(gone).getByRole("button", { name: ar.adminDelete }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText(ar.adminDeleteTypeName("مساحة بلا خطة")),
      "مساحة بلا خطة",
    );
    const confirm = within(dialog).getByRole("button", {
      name: ar.adminDeleteConfirm,
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(
        screen.queryByTestId("admin-row-00000000-0000-4000-8000-000000000006"),
      ).toBeNull(),
    );
    expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(5);

    const root = screen.getByTestId(
      "admin-row-00000000-0000-4000-8000-000000000001",
    );
    await userEvent.click(
      within(root).getByRole("button", { name: ar.adminDelete }),
    );
    const second = await screen.findByRole("dialog");
    await userEvent.type(
      within(second).getByLabelText(
        ar.adminDeleteTypeName("مساحة العمل الشخصية"),
      ),
      "مساحة العمل الشخصية",
    );
    const confirmRoot = within(second).getByRole("button", {
      name: ar.adminDeleteConfirm,
    });
    await waitFor(() => expect(confirmRoot).toBeEnabled());
    await userEvent.click(confirmRoot);
    expect(await within(second).findByRole("alert")).toHaveTextContent(
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
