// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ar } from "../strings/ar";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  listener: null as null | ((event: string) => void),
}));

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: auth.resetPasswordForEmail,
      updateUser: auth.updateUser,
      onAuthStateChange: (cb: (event: string) => void) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));
vi.mock("../session", () => ({
  useSession: () => ({ session: auth.session, loading: false }),
}));

import { ResetPassword } from "./ResetPassword";

function mount() {
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  );
}

describe("ResetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = null;
  });

  it("signed out: sends the link to this page, and answers the same whether the email has an account or not", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mount();
    await userEvent.type(
      screen.getByLabelText(ar.emailLabel),
      "someone@example.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: ar.resetRequestSend }),
    );
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "someone@example.com",
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      ar.resetRequestSent,
    );
  });

  it("signed out: a refused send says to try later", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "email rate limit exceeded", status: 429 },
    });
    mount();
    await userEvent.type(
      screen.getByLabelText(ar.emailLabel),
      "someone@example.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: ar.resetRequestSend }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      ar.resetRequestFailed,
    );
  });

  it("signed in by the link: two passwords that differ are refused before any call", async () => {
    auth.session = { user: { id: "u" } };
    mount();
    await userEvent.type(screen.getByLabelText(ar.resetNewLabel), "abcdefgh");
    await userEvent.type(
      screen.getByLabelText(ar.resetConfirmLabel),
      "abcdefgX",
    );
    await userEvent.click(screen.getByRole("button", { name: ar.resetSave }));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(ar.resetMismatch);
  });

  it("signed in by the link: sets the new password and offers the way on", async () => {
    auth.session = { user: { id: "u" } };
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    mount();
    await userEvent.type(screen.getByLabelText(ar.resetNewLabel), "abcdefgh");
    await userEvent.type(
      screen.getByLabelText(ar.resetConfirmLabel),
      "abcdefgh",
    );
    await userEvent.click(screen.getByRole("button", { name: ar.resetSave }));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "abcdefgh" });
    expect(await screen.findByRole("status")).toHaveTextContent(ar.resetDone);
    expect(
      screen.getByRole("link", { name: ar.resetToDashboard }),
    ).toHaveAttribute("href", "/dashboard");
  });
});

describe("useRecoveryLanding", () => {
  function Where() {
    return <p data-testid="where">{useLocation().pathname}</p>;
  }

  async function shell(hash: string, start: string) {
    vi.resetModules();
    window.location.hash = hash;
    const { useRecoveryLanding } = await import("./recoveryLanding");
    function Shell() {
      useRecoveryLanding(useLocation().pathname);
      return <Where />;
    }
    return render(
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="*" element={<Shell />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("takes a reader a recovery link landed on the root to the reset page, once", async () => {
    await shell("#access_token=x&type=recovery", "/");
    expect(screen.getByTestId("where")).toHaveTextContent("/reset-password");
  });

  it("leaves every other landing where it is", async () => {
    await shell("#access_token=x&type=signup", "/dashboard");
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard");
  });
});
