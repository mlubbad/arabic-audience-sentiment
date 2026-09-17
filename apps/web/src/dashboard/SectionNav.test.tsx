// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import { SECTIONS, SectionNav } from "./SectionNav";

describe("SectionNav", () => {
  it("renders one link per section, each pointing at its id", () => {
    render(<SectionNav active={null} S={ar} show={true} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(SECTIONS.length);
    for (const section of SECTIONS) {
      expect(
        screen.getByRole("link", { name: ar[section.label] }),
      ).toHaveAttribute("href", `#${section.id}`);
    }
  });

  it("marks only the active section current", () => {
    render(<SectionNav active="rp-voice" S={ar} show={true} />);
    const current = screen.getByRole("link", { name: ar.secVoice });
    expect(current).toHaveAttribute("aria-current", "true");
    for (const section of SECTIONS) {
      if (section.id === "rp-voice") continue;
      expect(
        screen.getByRole("link", { name: ar[section.label] }),
      ).not.toHaveAttribute("aria-current");
    }
  });

  it("renders no links when show is false", () => {
    render(<SectionNav active={null} S={ar} show={false} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
