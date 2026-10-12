// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ar } from "../strings/ar";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  recovery: false,
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
  reauthenticate: vi.fn(),
  clearRecovery: vi.fn(),
  listener: null as null | ((event: string) => void),
}));

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: auth.resetPasswordForEmail,
      updateUser: auth.updateUser,
      signInWithPassword: auth.signInWithPassword,
      reauthenticate: auth.reauthenticate,
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
vi.mock("./recoveryState", () => ({
  isRecoverySession: () => auth.recovery,
  markRecovery: vi.fn(),
  clearRecovery: auth.clearRecovery,
}));

import { ResetPassword } from "./ResetPassword";

const STRONG = "Str0ng!pass";

function mount() {
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  );
}

async function typeNew(password: string, again = password) {
  await userEvent.type(screen.getByLabelText(ar.resetNewLabel), password);
  await userEvent.type(screen.getByLabelText(ar.resetConfirmLabel), again);
}

const save = () =>
  userEvent.click(screen.getByRole("button", { name: ar.resetSave }));

describe("ResetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = null;
    auth.recovery = false;
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

  describe("signed in by the recovery link", () => {
    beforeEach(() => {
      auth.session = { user: { id: "u", email: "owner@example.com" } };
      auth.recovery = true;
    });

    it("asks for no current password: the link was the proof", () => {
      mount();
      expect(screen.queryByLabelText(ar.resetCurrentLabel)).toBeNull();
    });

    it("refuses two passwords that differ before any call", async () => {
      mount();
      await typeNew(STRONG, STRONG + "X");
      await save();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(ar.resetMismatch);
    });

    it("refuses the digits-only password the live site accepted, before any call, and shows which rules it misses", async () => {
      mount();
      await typeNew("12345678");
      const rules = screen.getByRole("list", { name: ar.resetRulesLabel });
      expect(rules).toHaveTextContent(`✓ ${ar.resetRuleLength}`);
      expect(rules).toHaveTextContent(`✓ ${ar.resetRuleDigit}`);
      expect(rules).toHaveTextContent(`○ ${ar.resetRuleLower}`);
      expect(rules).toHaveTextContent(`○ ${ar.resetRuleUpper}`);
      expect(rules).toHaveTextContent(`○ ${ar.resetRuleSymbol}`);
      await save();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(ar.resetPolicyFailed);
    });

    it("sets the new password with no sign-in, clears the recovery mark and offers the way on", async () => {
      auth.updateUser.mockResolvedValue({ data: {}, error: null });
      mount();
      await typeNew(STRONG);
      await save();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
      expect(auth.updateUser).toHaveBeenCalledWith({ password: STRONG });
      expect(auth.clearRecovery).toHaveBeenCalled();
      expect(await screen.findByRole("status")).toHaveTextContent(ar.resetDone);
      expect(
        screen.getByRole("link", { name: ar.resetToDashboard }),
      ).toHaveAttribute("href", "/dashboard");
    });

    it("names the cause when the server says the password is the same one", async () => {
      auth.updateUser.mockResolvedValue({
        data: null,
        error: {
          code: "same_password",
          status: 422,
          message: "New password should be different from the old password.",
        },
      });
      mount();
      await typeNew(STRONG);
      await save();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetSamePassword,
      );
      expect(auth.clearRecovery).not.toHaveBeenCalled();
    });

    it("shows the server's reasons when it still finds the password weak", async () => {
      auth.updateUser.mockResolvedValue({
        data: null,
        error: {
          code: "weak_password",
          status: 422,
          message: "weak",
          reasons: ["pwned"],
        },
      });
      mount();
      await typeNew(STRONG);
      await save();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetWeak([ar.resetWeakPwned]),
      );
    });

    it("says the link expired when the session is gone, and shows an unknown code as is", async () => {
      auth.updateUser.mockResolvedValueOnce({
        data: null,
        error: { code: "session_expired", status: 403, message: "x" },
      });
      mount();
      await typeNew(STRONG);
      await save();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetLinkExpired,
      );
      auth.updateUser.mockResolvedValueOnce({
        data: null,
        error: { code: "hook_timeout", status: 500, message: "x" },
      });
      await save();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetFailedCode("hook_timeout"),
      );
    });
  });

  describe("signed in some other way", () => {
    beforeEach(() => {
      auth.session = { user: { id: "u", email: "owner@example.com" } };
      auth.recovery = false;
    });

    it("asks for the current password and refuses a wrong one without changing anything", async () => {
      auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { code: "invalid_credentials", status: 400, message: "x" },
      });
      mount();
      await userEvent.type(
        screen.getByLabelText(ar.resetCurrentLabel),
        "not-it",
      );
      await typeNew(STRONG);
      await save();
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "not-it",
      });
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetCurrentWrong,
      );
    });

    it("changes the password once the current one is proven", async () => {
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
      auth.updateUser.mockResolvedValue({ data: {}, error: null });
      mount();
      await userEvent.type(
        screen.getByLabelText(ar.resetCurrentLabel),
        "Old!pass1",
      );
      await typeNew(STRONG);
      await save();
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "Old!pass1",
      });
      expect(auth.updateUser).toHaveBeenCalledWith({ password: STRONG });
      expect(await screen.findByRole("status")).toHaveTextContent(ar.resetDone);
    });

    it("when the project asks for reauthentication, sends the emailed code, asks for it, and saves with it", async () => {
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
      auth.updateUser
        .mockResolvedValueOnce({
          data: null,
          error: { code: "reauthentication_needed", status: 400, message: "x" },
        })
        .mockResolvedValueOnce({ data: {}, error: null });
      auth.reauthenticate.mockResolvedValue({ data: {}, error: null });
      mount();
      await userEvent.type(
        screen.getByLabelText(ar.resetCurrentLabel),
        "Old!pass1",
      );
      await typeNew(STRONG);
      await save();
      expect(auth.reauthenticate).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole("status")).toHaveTextContent(
        ar.resetCodeSent,
      );
      await userEvent.type(screen.getByLabelText(ar.resetCodeLabel), "123456");
      await save();
      expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(auth.updateUser).toHaveBeenLastCalledWith({
        password: STRONG,
        nonce: "123456",
      });
      expect(await screen.findByRole("status")).toHaveTextContent(ar.resetDone);
    });

    it("with no email on the account, points to the recovery link instead", async () => {
      auth.session = { user: { id: "u" } };
      mount();
      await userEvent.type(screen.getByLabelText(ar.resetCurrentLabel), "x");
      await typeNew(STRONG);
      await save();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        ar.resetNoEmail,
      );
    });
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
