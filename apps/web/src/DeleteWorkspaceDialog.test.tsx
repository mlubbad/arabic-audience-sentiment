// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "./strings/ar";

const shared = vi.hoisted(() => ({
  rpc: vi.fn<
    (
      fn: string,
      args: { w: string },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  >(),
}));
vi.mock("./supabase", () => ({
  supabase: { rpc: (fn: string, args: { w: string }) => shared.rpc(fn, args) },
}));
vi.mock("./ui/Toast", () => ({ toast: vi.fn() }));

import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { toast } from "./ui/Toast";

const W = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const footprint = {
  channels: 1,
  videos: 3,
  comments: 420,
  predictions: 400,
  reviews: 2,
  members: 1,
};

beforeEach(() => {
  shared.rpc.mockReset();
  shared.rpc.mockImplementation(async (fn) =>
    fn === "admin_workspace_footprint"
      ? { data: footprint, error: null }
      : { data: null, error: null },
  );
  vi.mocked(toast).mockReset();
});

const open = async () => {
  const onDeleted = vi.fn();
  render(
    <DeleteWorkspaceDialog
      workspace={{ id: W, name: "عميل للتسليم 1" }}
      onDeleted={onDeleted}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: ar.adminDelete }));
  return onDeleted;
};

describe("DeleteWorkspaceDialog", () => {
  it("is closed until the lever is pressed, then names the workspace and counts what goes", async () => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    expect(
      await screen.findByRole("dialog", {
        name: ar.adminDeleteTitle("عميل للتسليم 1"),
      }),
    ).toBeVisible();
    expect(
      await screen.findByText(ar.adminDeleteFootprint(footprint)),
    ).toBeVisible();
    expect(shared.rpc).toHaveBeenCalledWith("admin_workspace_footprint", {
      w: W,
    });
  });

  it("confirm stays disabled until the name is typed back exactly", async () => {
    await open();
    await screen.findByRole("dialog");
    const confirm = screen.getByRole("button", { name: ar.adminDeleteConfirm });
    expect(confirm).toBeDisabled();
    const box = screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1"));
    await userEvent.type(box, "عميل للتسليم");
    expect(confirm).toBeDisabled();
    await userEvent.type(box, " 1");
    expect(confirm).toBeEnabled();
  });

  it("confirm calls delete_workspace, toasts, and reports back", async () => {
    const onDeleted = await open();
    await screen.findByRole("dialog");
    await userEvent.type(
      screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1")),
      "عميل للتسليم 1",
    );
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminDeleteConfirm }),
    );
    await waitFor(() =>
      expect(shared.rpc).toHaveBeenCalledWith("delete_workspace", { w: W }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({
      title: ar.adminDeleteDone("عميل للتسليم 1"),
    });
  });

  it("cannot be dismissed while the delete is in flight", async () => {
    let settle!: (v: { data: null; error: null }) => void;
    shared.rpc.mockImplementation((fn) =>
      fn === "admin_workspace_footprint"
        ? Promise.resolve({ data: footprint, error: null })
        : new Promise((resolve) => {
            settle = resolve;
          }),
    );
    const onDeleted = await open();
    await screen.findByRole("dialog");
    await userEvent.type(
      screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1")),
      "عميل للتسليم 1",
    );
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminDeleteConfirm }),
    );
    // In flight: Escape and the corner close do nothing.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminDeleteClose }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    // Settled: now it closes and reports, exactly once.
    settle({ data: null, error: null });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["billing_root", ar.adminDeleteBillingRoot],
    ["last_workspace", ar.adminDeleteLast],
    ["paddle_subscription_active", ar.adminPaddleActive],
  ])(
    "a %s refusal is said in the dialog, and nothing is reported as deleted",
    async (code, sentence) => {
      shared.rpc.mockImplementation(async (fn) =>
        fn === "admin_workspace_footprint"
          ? { data: footprint, error: null }
          : { data: null, error: { message: code } },
      );
      const onDeleted = await open();
      await screen.findByRole("dialog");
      await userEvent.type(
        screen.getByLabelText(ar.adminDeleteTypeName("عميل للتسليم 1")),
        "عميل للتسليم 1",
      );
      await userEvent.click(
        screen.getByRole("button", { name: ar.adminDeleteConfirm }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
      expect(onDeleted).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );
});
