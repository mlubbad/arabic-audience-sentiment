import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  const html = renderToStaticMarkup(createElement(Probe));
  expect(html).toContain("&quot;loading&quot;:true");
  expect(html).toContain("&quot;workspaces&quot;:[]");
});
