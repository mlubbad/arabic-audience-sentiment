import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { useWorkspaces } from "./session";

it("treats a signed-in user's workspaces as loading until their own list is read", () => {
  function Probe() {
    const result = useWorkspaces({ user: { id: "user-b" } } as Session);
    return createElement(
      "span",
      null,
      JSON.stringify({
        loading: result.loading,
        workspaces: result.workspaces,
      }),
    );
  }
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Probe),
    ),
  );
  expect(html).toContain("&quot;loading&quot;:true");
  expect(html).toContain("&quot;workspaces&quot;:[]");
});

it("reads every user's list under a key that names them, so one invalidation reaches every reader", async () => {
  const { workspacesKey } = await import("./session");
  expect(workspacesKey("user-b")).toEqual(["workspaces", "user-b"]);
  // The prefix is what AdminPage and Account invalidate after a delete,
  // a rename, a retire or a create.
  expect(workspacesKey("user-b")[0]).toBe("workspaces");
});
