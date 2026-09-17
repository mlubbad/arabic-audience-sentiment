// @vitest-environment jsdom
/** One row of the admin table, driven with a fake `act`: what the plan form
 *  sends, what the pack form refuses to send, and how a refusal from either
 *  side of the wire is said. No server, no reducer — the row's contract is
 *  the action it hands over and the sentence it prints back. */
import "@testing-library/jest-dom/vitest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminWorkspace } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { adminRows } from "../adminWords";

vi.mock("../supabase", () => ({ supabase: null }));
vi.mock("../ui/Toast", () => ({ toast: vi.fn() }));

import { WorkspaceRow, type AdminAction } from "./WorkspaceRow";
import { toast } from "../ui/Toast";

const W = "00000000-0000-4000-8000-000000000003";
const workspace: AdminWorkspace = {
  id: W,
  name: "وكالة نبض الإعلامية",
  created_by: "00000000-0000-4000-8000-0000000000c3",
  plan_key: "agency",
  status: "active",
  period_end: "2026-10-01T00:00:00Z",
  provider: "paddle",
};
const options = [
  { key: "free", label: "مجاني" },
  { key: "agency", label: "وكالة" },
  { key: "enterprise", label: "مؤسسات" },
];
const keys = options.map((o) => o.key);

function mount(act: (action: AdminAction) => Promise<void>, stacked = false) {
  const [row] = adminRows([workspace], ar);
  return render(
    stacked ? (
      <WorkspaceRow
        workspace={workspace}
        row={row}
        keys={keys}
        options={options}
        act={act}
        stacked
      />
    ) : (
      <table>
        <tbody>
          <WorkspaceRow
            workspace={workspace}
            row={row}
            keys={keys}
            options={options}
            act={act}
          />
        </tbody>
      </table>
    ),
  );
}

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

const planForm = () => screen.getByTestId("admin-plan-form");
const packForm = () => screen.getByTestId("admin-pack-form");

beforeEach(() => {
  vi.mocked(toast).mockReset();
});

describe("WorkspaceRow", () => {
  it("carries its workspace id as its test id, prints the row's values, and offers both forms", () => {
    mount(vi.fn(async () => {}));
    const row = screen.getByTestId(`admin-row-${W}`);
    expect(row.tagName).toBe("TBODY");
    expect(row).toHaveTextContent("وكالة نبض الإعلامية");
    expect(row).toHaveTextContent("agency");
    expect(row).toHaveTextContent("2026-10-01");
    expect(row).toHaveTextContent("paddle");
    expect(within(row).getByTestId("admin-plan-form")).toBeInTheDocument();
    expect(within(row).getByTestId("admin-pack-form")).toBeInTheDocument();
  });

  it("stacked, it is a card with a definition list rather than a table row", () => {
    mount(
      vi.fn(async () => {}),
      true,
    );
    const row = screen.getByTestId(`admin-row-${W}`);
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector("dl")).not.toBeNull();
    expect(
      within(row).getByRole("heading", { name: "وكالة نبض الإعلامية" }),
    ).toBeInTheDocument();
    expect(within(row).getByTestId("admin-plan-form")).toBeInTheDocument();
    expect(within(row).getByTestId("admin-pack-form")).toBeInTheDocument();
  });

  it("the plan form sends the chosen plan, the months, a null note for an empty one, and the override", async () => {
    const act = vi.fn<(action: AdminAction) => Promise<void>>(async () => {});
    mount(act);
    const form = planForm();
    // The select starts on the row's own plan.
    expect(
      within(form).getByRole("combobox", { name: ar.adminPlanPicker }),
    ).toHaveTextContent("وكالة");
    await userEvent.click(
      within(form).getByRole("combobox", { name: ar.adminPlanPicker }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "مؤسسات" }),
    );
    const months = within(form).getByLabelText(ar.adminMonths);
    await userEvent.clear(months);
    await userEvent.type(months, "6");
    await userEvent.click(
      within(form).getByRole("checkbox", { name: ar.adminOverride }),
    );
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminSetPlan }),
    );
    await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
    expect(act).toHaveBeenCalledWith({
      type: "set_plan",
      w: W,
      plan_key: "enterprise",
      months: 6,
      note: null,
      override: true,
    });
    expect(await within(form).findByRole("status")).toHaveTextContent(
      ar.adminDone,
    );
    expect(toast).toHaveBeenCalledWith({
      title: ar.adminDone,
      description: "وكالة نبض الإعلامية",
    });
  });

  it("a trimmed plan note travels as text, not null", async () => {
    const act = vi.fn<(action: AdminAction) => Promise<void>>(async () => {});
    mount(act);
    const form = planForm();
    await userEvent.type(
      within(form).getByLabelText(ar.adminNote),
      "  تفعيل يدوي  ",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminSetPlan }),
    );
    await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
    expect(act.mock.calls[0][0]).toMatchObject({
      type: "set_plan",
      plan_key: "agency",
      months: 1,
      note: "تفعيل يدوي",
      override: false,
    });
  });

  it("the plan button waits while the months are not a whole number in range", async () => {
    const act = vi.fn<(action: AdminAction) => Promise<void>>(async () => {});
    mount(act);
    const form = planForm();
    const button = within(form).getByRole("button", { name: ar.adminSetPlan });
    expect(button).toBeEnabled();
    const months = within(form).getByLabelText(ar.adminMonths);
    await userEvent.clear(months);
    expect(button).toBeDisabled();
    await userEvent.type(months, "0");
    expect(button).toBeDisabled();
    await userEvent.clear(months);
    await userEvent.type(months, "1201");
    expect(button).toBeDisabled();
    expect(act).not.toHaveBeenCalled();
  });

  it("the pack form needs both a positive whole number of units and a note before it will send", async () => {
    const act = vi.fn<(action: AdminAction) => Promise<void>>(async () => {});
    mount(act);
    const form = packForm();
    const button = within(form).getByRole("button", {
      name: ar.adminGrantPack,
    });
    // Units default to 10000; the note is empty, so nothing goes yet.
    expect(button).toBeDisabled();
    const note = within(form).getByLabelText(ar.adminNote);
    await userEvent.type(note, "حزمة الإطلاق");
    expect(button).toBeEnabled();
    const units = within(form).getByLabelText(ar.adminUnits);
    await userEvent.clear(units);
    expect(button).toBeDisabled();
    await userEvent.type(units, "0");
    expect(button).toBeDisabled();
    await userEvent.clear(units);
    await userEvent.type(units, "2500");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
    expect(act).toHaveBeenCalledWith({
      type: "grant_pack",
      w: W,
      kind: "comment_analysis",
      units: 2500,
      note: "حزمة الإطلاق",
    });
    expect(await within(form).findByRole("status")).toHaveTextContent(
      ar.adminDone,
    );
  });

  it("the pack kind is chosen on a labelled select", async () => {
    const act = vi.fn<(action: AdminAction) => Promise<void>>(async () => {});
    mount(act);
    const form = packForm();
    await userEvent.click(
      within(form).getByRole("combobox", { name: ar.adminKind }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: ar.budgetTopics }),
    );
    await userEvent.type(within(form).getByLabelText(ar.adminNote), "x");
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminGrantPack }),
    );
    await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
    expect(act.mock.calls[0][0]).toMatchObject({
      kind: "topic_classification",
    });
  });

  it.each([
    ["paddle_subscription_active", "55000", ar.adminPaddleActive] as const,
    ["unknown_plan", "22023", ar.adminFailed("unknown_plan")] as const,
    ["forbidden", "42501", ar.adminForbidden] as const,
    ["boom", "PGRST301", ar.adminFailed("PGRST301")] as const,
  ])(
    "a %s refusal is said in the plan form's own status line, and nothing is toasted",
    async (message, code, sentence) => {
      const act = vi.fn(async () => {
        throw { message, code };
      });
      mount(act);
      const form = planForm();
      await userEvent.click(
        within(form).getByRole("button", { name: ar.adminSetPlan }),
      );
      expect(await within(form).findByRole("status")).toHaveTextContent(
        sentence,
      );
      // The other form says nothing about it.
      expect(within(packForm()).queryByRole("status")).toBeNull();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it("a refused pack is said in the pack form's line, not the plan form's", async () => {
    const act = vi.fn(async () => {
      throw { message: "no_active_plan", code: "42501" };
    });
    mount(act);
    const form = packForm();
    await userEvent.type(within(form).getByLabelText(ar.adminNote), "x");
    await userEvent.click(
      within(form).getByRole("button", { name: ar.adminGrantPack }),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      ar.adminFailed("no_active_plan"),
    );
    expect(within(planForm()).queryByRole("status")).toBeNull();
  });

  it("both forms wait while either lever is in flight", async () => {
    let settle!: () => void;
    const act = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    mount(act);
    await userEvent.click(
      within(planForm()).getByRole("button", { name: ar.adminSetPlan }),
    );
    expect(within(planForm()).getByRole("status")).toHaveTextContent(
      ar.working,
    );
    expect(
      within(packForm()).getByRole("button", { name: ar.adminGrantPack }),
    ).toBeDisabled();
    expect(within(packForm()).getByLabelText(ar.adminUnits)).toBeDisabled();
    settle();
    expect(await within(planForm()).findByText(ar.adminDone)).toBeVisible();
    expect(within(packForm()).getByLabelText(ar.adminUnits)).toBeEnabled();
  });
});
