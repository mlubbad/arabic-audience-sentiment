// @vitest-environment jsdom
/** The rail's workspace switch, rendered for real.
 *
 * RailState.test.ts renders the rail statically and asserts HTML. That is
 * right for the collection line and the single-workspace name, and wrong for
 * the switch now that it is a Radix Select: the listbox is portaled and only
 * mounted while open, and the trigger's text is resolved from items that
 * register on mount — nothing a static render can see. These cases open it.
 */
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ar } from "./strings/ar";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const shared = vi.hoisted(() => ({
  user: "owner" as string | null,
  workspaces: [] as { id: string; name: string }[],
}));

vi.mock("./session", () => ({
  useSession: () => ({
    session: shared.user ? { user: { id: shared.user } } : null,
    loading: false,
  }),
  useWorkspaces: () => ({
    workspaces: shared.workspaces,
    loading: false,
    failed: false,
  }),
}));
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return { ...real, configuredMode: "live", loadSource: vi.fn() };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { WorkspaceSwitch } from "./RailState";
import {
  resetWorkspaceSelection,
  selectionFor,
  selectWorkspace,
} from "./workspaceSelection";

const renderSwitch = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <WorkspaceSwitch />
    </MemoryRouter>,
  );

beforeEach(() => {
  shared.user = "owner";
  shared.workspaces = [
    { id: A, name: "قناة أ" },
    { id: B, name: "قناة ب" },
  ];
  resetWorkspaceSelection();
});

describe("the rail's workspace switch", () => {
  it("names the chosen workspace on the closed trigger", () => {
    selectWorkspace("owner", B);
    renderSwitch();
    expect(
      screen.getByRole("combobox", { name: ar.changeWorkspace }),
    ).toHaveTextContent("قناة ب");
  });

  it("asks from the rail when nothing is chosen", () => {
    renderSwitch();
    expect(
      screen.getByRole("combobox", { name: ar.changeWorkspace }),
    ).toHaveTextContent(ar.choosePlaceholder);
  });

  it("picking a workspace writes the selection the pages read", async () => {
    renderSwitch();
    await userEvent.click(
      screen.getByRole("combobox", { name: ar.changeWorkspace }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "قناة أ" }),
    );
    expect(selectionFor("owner")).toBe(A);
    expect(
      screen.getByRole("combobox", { name: ar.changeWorkspace }),
    ).toHaveTextContent("قناة أ");
  });
});
