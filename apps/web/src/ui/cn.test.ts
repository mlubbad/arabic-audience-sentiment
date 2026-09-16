import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn: merges classNames the way Tailwind utility conflicts need", () => {
  it("joins plain strings", () => {
    expect(cn("ui-btn", "ui-btn--primary")).toBe("ui-btn ui-btn--primary");
  });

  it("drops falsy values", () => {
    // A condition that is off, as a call site writes it — held in a variable
    // so the linter does not read `false && …` as a mistake.
    const primary = false as boolean;
    expect(cn("ui-btn", primary && "ui-btn--primary", undefined, null)).toBe(
      "ui-btn",
    );
  });

  it("lets a later conflicting Tailwind class win over an earlier one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
