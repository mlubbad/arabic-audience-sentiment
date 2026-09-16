// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// AdminPage pulls in Supabase, react-query and the locale store; this test
// exercises only the plan Select inside WorkspaceRow's markup shape, the
// same way Select.test.tsx already proves the primitive itself — so it
// renders a minimal stand-in built from the same three ui/ components
// AdminPage.tsx now imports, rather than standing up the whole page's data
// layer. (Full-page coverage is Playwright's job, unchanged by this task.)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";
import { ar } from "./strings/ar";

function PlanPicker({ onChange }: { onChange: (v: string) => void }) {
  return (
    <label>
      {ar.adminPlan}
      <Select defaultValue="founding_partner" onValueChange={onChange}>
        <SelectTrigger aria-label={ar.adminPlanPicker}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="founding_partner">شريك مؤسِّس</SelectItem>
          <SelectItem value="growth">نمو</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

describe("the admin plan picker (Select, as wired into WorkspaceRow)", () => {
  it("is reachable by its Arabic label and reports the chosen plan key", async () => {
    const onChange = vi.fn();
    render(<PlanPicker onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("combobox", { name: ar.adminPlanPicker }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "نمو" }));
    expect(onChange).toHaveBeenCalledWith("growth");
  });
});
