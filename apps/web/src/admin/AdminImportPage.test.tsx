// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "../strings/ar";
import * as adminShellModule from "./AdminShell";
import { AdminImportPage } from "./AdminImportPage";

const ME = "10000000-0000-4000-8000-000000000001";
const HOME = "20000000-0000-4000-8000-000000000001";
const NEW_WS = "20000000-0000-4000-8000-000000000002";
const NEW_CH = "30000000-0000-4000-8000-000000000001";
const ID_A = "UCAAAAAAAAAAAAAAAAAAAAA1";
const ID_B1 = "UCBBBBBBBBBBBBBBBBBBBBB1";
const ID_B2 = "UCBBBBBBBBBBBBBBBBBBBBB2";

const { rpc, invoke } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../supabase", () => ({
  supabase: { rpc, functions: { invoke } },
}));
vi.mock("../session", () => ({
  useSession: () => ({ session: { user: { id: ME } }, loading: false }),
}));
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof adminShellModule>();
  return {
    ...actual,
    useAdminShell: () => ({
      admin: true,
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
    AdminPageHead: ({ title }: { title: string }) => <h1>{title}</h1>,
  };
});

const candidate = (id: string, title: string) => ({
  external_channel_id: id,
  handle: null,
  title,
  thumbnail_url: null,
  platform: "youtube" as const,
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function upload(text: string) {
  const input = await screen.findByTestId("admin-import-file");
  const file = new File([text], "channels.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  invoke.mockReset();
  rpc.mockImplementation(async (fn: string) =>
    fn === "my_workspaces"
      ? {
          data: [
            { id: "99999999-0000-4000-8000-000000000001", created_by: "x" },
            { id: HOME, created_by: ME },
          ],
          error: null,
        }
      : { data: null, error: { code: "P0001", message: "unexpected call" } },
  );
});

afterEach(() => {
  localStorage.clear();
});

describe("AdminImportPage", () => {
  it("looks each row up from the owner's workspace, proposes only an exact match, and imports what was confirmed", async () => {
    invoke.mockImplementation(
      async (_fn: string, { body }: { body: { query: string } }) => ({
        data: {
          candidates:
            body.query === "Alpha"
              ? [candidate(ID_A, "alpha")]
              : [candidate(ID_B1, "Beta Kids"), candidate(ID_B2, "Beta TV")],
        },
        error: null,
      }),
    );
    mount();
    await upload("name\nAlpha\nBeta");
    expect(await screen.findByTestId("admin-import-summary")).toHaveTextContent(
      ar.adminImportSummary(2, 0, 2),
    );

    fireEvent.click(screen.getByTestId("admin-import-find"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenCalledWith("channel-lookup", {
      body: { workspace_id: HOME, query: "Alpha", platform: "youtube" },
    });

    // Alpha's title matches the file exactly: proposed. Beta's do not: the
    // owner chooses.
    const run = await screen.findByTestId("admin-import-run");
    await waitFor(() => expect(run).toHaveTextContent(ar.adminImportRun(1)));
    const beta = screen.getByTestId("admin-import-row-2");
    expect(
      within(beta)
        .getAllByRole("radio")
        .filter((r) => (r as HTMLInputElement).checked),
    ).toHaveLength(0);

    rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn === "my_workspaces")
          return { data: [{ id: HOME, created_by: ME }], error: null };
        if (fn === "admin_import_channel" && args.p_external === ID_A)
          return {
            data: {
              status: "created",
              workspace_id: NEW_WS,
              workspace_name: "alpha",
              channel_id: NEW_CH,
              job_id: null,
            },
            error: null,
          };
        if (fn === "admin_import_channel" && args.p_external === ID_B2)
          return {
            data: {
              status: "exists",
              workspace_id: HOME,
              workspace_name: "Home",
            },
            error: null,
          };
        return { data: null, error: { code: "P0001", message: "unexpected" } };
      },
    );

    fireEvent.click(run);
    await waitFor(() =>
      expect(screen.getByTestId("admin-import-row-1")).toHaveTextContent(
        ar.adminImportCreated,
      ),
    );
    expect(rpc).toHaveBeenCalledWith("admin_import_channel", {
      p_external: ID_A,
      p_title: "alpha",
      p_handle: null,
      p_platform: "youtube",
    });

    // The owner picks Beta TV once the run is over, then creates it: the
    // account already holds it.
    const runAgain = await screen.findByTestId("admin-import-run");
    fireEvent.click(within(beta).getByLabelText(/Beta TV/));
    await waitFor(() =>
      expect(runAgain).toHaveTextContent(ar.adminImportRun(1)),
    );
    fireEvent.click(runAgain);
    await waitFor(() =>
      expect(beta).toHaveTextContent(ar.adminImportExists("Home")),
    );
    expect(screen.getByTestId("admin-import-done")).toHaveTextContent(
      ar.adminImportDone(1, 1, 0),
    );
  });

  it("stops looking up when YouTube's daily quota is spent", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: "quota_exceeded" }), {
          status: 429,
        }),
      },
    });
    mount();
    await upload("name\nOne\nTwo\nThree");
    fireEvent.click(await screen.findByTestId("admin-import-find"));
    expect(await screen.findByText(ar.adminImportQuotaHalted)).toBeVisible();
    expect(invoke).toHaveBeenCalledTimes(1);
    // The row is not marked failed: it waits to be looked up again.
    expect(screen.getByTestId("admin-import-row-1")).toHaveTextContent(
      ar.adminImportWaiting,
    );
  });

  it("says so when the file names no channel column", async () => {
    mount();
    await upload("foo,bar\n1,2");
    expect(await screen.findByText(ar.adminImportEmptyFile)).toBeVisible();
    expect(screen.queryByTestId("admin-import-summary")).toBeNull();
  });

  it("asks for a workspace of the owner's own before any lookup", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    mount();
    expect(await screen.findByText(ar.adminImportNoHome)).toBeVisible();
    expect(screen.queryByTestId("admin-import-file")).toBeNull();
  });
});
