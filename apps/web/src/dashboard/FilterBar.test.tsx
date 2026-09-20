// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { ar } from "../strings/ar";
import { FilterBar, type FilterBarProps } from "./FilterBar";
import { EMPTY_FILTERS } from "./filters";

function renderBar(overrides: Partial<FilterBarProps> = {}) {
  const props: FilterBarProps = {
    values: EMPTY_FILTERS,
    onChange: vi.fn(),
    onApply: vi.fn(),
    onReset: vi.fn(),
    onLimitChange: vi.fn(),
    formError: "",
    videoOptions: [{ id: "v1", title: "فيديو" }],
    topics: null,
    commentTypes: [],
    S: ar,
    lang: "ar",
    labels: ar.labels,
    appliedCount: 0,
    ...overrides,
  };
  render(
    <DirectionProvider dir="rtl">
      <FilterBar {...props} />
    </DirectionProvider>,
  );
  return props;
}

afterEach(() => {
  // Never leaked from the compact test into any other: jsdom has no
  // matchMedia at all until a test stubs it (see useMediaQuery.ts's guard).
  // @ts-expect-error -- test-only cleanup of a test-only stub
  delete window.matchMedia;
});

describe("FilterBar", () => {
  it("resolves the desktop row's controls by label", () => {
    renderBar();
    expect(screen.getByLabelText(ar.searchLabel)).toBeInstanceOf(
      HTMLInputElement,
    );
    expect(screen.getByLabelText(ar.videoLabelText)).toHaveAttribute(
      "role",
      "combobox",
    );
    expect(screen.getByLabelText(ar.sentimentLabel)).toHaveAttribute(
      "role",
      "combobox",
    );
    expect(
      screen.getByRole("button", { name: ar.dateLabel }),
    ).toBeInTheDocument();
  });

  it("shows the more-filters count on the trigger and the six controls once opened", async () => {
    renderBar();
    const moreButton = screen.getByRole("button", {
      name: ar.moreFilters(0),
    });
    await userEvent.click(moreButton);
    expect(
      await screen.findByLabelText(ar.participationLabel),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(ar.reviewStatusLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(ar.platformFilterLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(ar.videoKindLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(ar.perPageLabel)).toBeInTheDocument();
  });

  it("counts a set 'more' control on its trigger", () => {
    renderBar({ values: { ...EMPTY_FILTERS, replies: "replies" } });
    expect(
      screen.getByRole("button", { name: ar.moreFilters(1) }),
    ).toBeInTheDocument();
  });

  it("submits through the form and resets on the reset button", async () => {
    const props = renderBar();
    fireEvent.submit(screen.getByRole("form", { name: ar.filtersLabel }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole("button", { name: ar.resetFilters }),
    );
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("calls onChange while typing in the search field", async () => {
    const props = renderBar();
    await userEvent.type(screen.getByLabelText(ar.searchLabel), "x");
    expect(props.onChange).toHaveBeenCalledWith({ query: "x" });
  });

  it("calls onChange with the picked sentiment", async () => {
    const props = renderBar();
    await userEvent.click(
      screen.getByRole("combobox", { name: ar.sentimentLabel }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: ar.labels.negative }),
    );
    expect(props.onChange).toHaveBeenCalledWith({ sentiment: "negative" });
  });

  it("renders the form error as an alert", () => {
    renderBar({ formError: "خطأ" });
    expect(screen.getByRole("alert")).toHaveTextContent("خطأ");
  });

  it("collapses into a sheet on a narrow viewport", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 900px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderBar();
    expect(
      screen.getByRole("button", { name: ar.filtersButton(0) }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    await userEvent.click(
      screen.getByRole("button", { name: ar.filtersButton(0) }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("combobox", { name: ar.videoLabelText }),
    ).toBeInTheDocument();
    // Closing hands focus back to the button that opened it — the button is
    // the dialog's own trigger, so Radix knows where focus came from. A
    // reader who pressed Escape used to land on <body>.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: ar.filtersButton(0) }),
    ).toHaveFocus();
  });
});
