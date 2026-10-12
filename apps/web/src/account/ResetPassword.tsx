/**
 * `/reset-password`: the way back for a person who forgot their password,
 * and where the link the owner sends from the account file lands.
 *
 * Three screens:
 * - signed out: the email form. Supabase's `/recover` sends the link; the
 *   answer is the same whether the email has an account or not, so the page
 *   never tells a stranger who is registered;
 * - signed in by a recovery link (`type=recovery`, see `recoveryState.ts`):
 *   the new password, twice; the link was the proof;
 * - signed in any other way: the same, after the current password, checked
 *   with a sign-in before `updateUser`, so a borrowed session alone cannot
 *   change it. When the project's "secure password change" asks for more
 *   (`reauthentication_needed`), the page sends the emailed code and asks
 *   for it.
 *
 * The rules in `passwordPolicy.ts` are checked here first and shown as a
 * list; the server's `weak_password` answer, with its reasons, still wins.
 *
 * Supabase may land a recovery link on the site's root instead of here when
 * this address is missing from the project's redirect list;
 * `useRecoveryLanding` (`recoveryLanding.ts`) sends that reader on here.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase } from "../supabase";
import { useSession } from "../session";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Loading } from "../pageStates/PageStates";
import "../pages.css";
import "./account.css";
import { RESET_PATH } from "./recoveryLanding";
import { clearRecovery, isRecoverySession } from "./recoveryState";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordProblems,
  type PasswordRule,
} from "./passwordPolicy";
import { describeResetError, type AuthFailure } from "./resetErrors";

type Note = { ok: boolean; text: string } | null;

export function ResetPassword() {
  const S = useStrings();
  const { session, loading } = useSession();
  return (
    <div className="db-page">
      <div className="db-grid db-grid--entry">
        {loading ? (
          <Loading S={S} label={S.pageOpening} shape="ops" />
        ) : session ? (
          <SetPassword
            email={session.user.email ?? null}
            recovery={isRecoverySession()}
          />
        ) : (
          <RequestLink />
        )}
      </div>
    </div>
  );
}

function RequestLink() {
  const S = useStrings();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setNote(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${RESET_PATH}`,
      });
      setNote(
        error
          ? { ok: false, text: S.resetRequestFailed }
          : { ok: true, text: S.resetRequestSent },
      );
    } catch {
      setNote({ ok: false, text: S.resetRequestFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card asChild className="db-entry-form">
      <form onSubmit={submit} data-testid="reset-request">
        <h2>{S.resetRequestTitle}</h2>
        <p className="db-lead">{S.resetRequestLead}</p>
        <div className="ui-field">
          <label htmlFor="reset-email">{S.emailLabel}</label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {note && <p role={note.ok ? "status" : "alert"}>{note.text}</p>}
        <Button type="submit" disabled={busy} className="db-entry-submit">
          {S.resetRequestSend}
        </Button>
        <p className="db-switch">
          <Link to="/account">{S.resetBackToSignIn}</Link>
        </p>
      </form>
    </Card>
  );
}

function ruleLabel(rule: PasswordRule, S: ReturnType<typeof useStrings>) {
  switch (rule) {
    case "length":
      return S.resetRuleLength;
    case "lower":
      return S.resetRuleLower;
    case "upper":
      return S.resetRuleUpper;
    case "digit":
      return S.resetRuleDigit;
    case "symbol":
      return S.resetRuleSymbol;
  }
}

function SetPassword({
  email,
  recovery,
}: {
  email: string | null;
  recovery: boolean;
}) {
  const S = useStrings();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const problems = passwordProblems(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password !== again) {
      setNote({ ok: false, text: S.resetMismatch });
      return;
    }
    if (problems.length) {
      setNote({ ok: false, text: S.resetPolicyFailed });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      // Not a recovery link: the current password first. A sign-in checks
      // it on the server and, with "secure password change" on, is also the
      // recent login that change requires.
      if (!recovery && !needCode) {
        if (!email) {
          setNote({ ok: false, text: S.resetNoEmail });
          return;
        }
        const signIn = await supabase.auth.signInWithPassword({
          email,
          password: current,
        });
        if (signIn.error) {
          setNote({ ok: false, text: S.resetCurrentWrong });
          return;
        }
      }
      const { error } = await supabase.auth.updateUser(
        needCode ? { password, nonce: code } : { password },
      );
      if (!error) {
        clearRecovery();
        setDone(true);
        setNote({ ok: true, text: S.resetDone });
        return;
      }
      const failure = error as AuthFailure;
      if (failure.code === "reauthentication_needed") {
        const re = await supabase.auth.reauthenticate();
        if (re.error) {
          setNote({ ok: false, text: describeResetError(re.error, S) });
        } else {
          setNeedCode(true);
          setNote({ ok: true, text: S.resetCodeSent });
        }
        return;
      }
      setNote({ ok: false, text: describeResetError(failure, S) });
    } catch {
      setNote({ ok: false, text: S.resetFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card asChild className="db-entry-form">
      <form onSubmit={submit} data-testid="reset-set">
        <h2>{S.resetSetTitle}</h2>
        <p className="db-lead">{S.resetSetLead}</p>
        {!recovery && (
          <>
            <p className="db-lead">{S.resetCurrentLead}</p>
            <div className="ui-field">
              <label htmlFor="reset-current">{S.resetCurrentLabel}</label>
              <Input
                id="reset-current"
                type="password"
                autoComplete="current-password"
                required
                disabled={done || needCode}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="ui-field">
          <label htmlFor="reset-new">{S.resetNewLabel}</label>
          <Input
            id="reset-new"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            disabled={done}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <ul className="db-rules" aria-label={S.resetRulesLabel}>
          {PASSWORD_RULES.map((rule) => {
            const ok = password.length > 0 && !problems.includes(rule);
            return (
              <li key={rule} data-ok={ok ? "true" : "false"}>
                {ok ? "✓" : "○"} {ruleLabel(rule, S)}
              </li>
            );
          })}
        </ul>
        <div className="ui-field">
          <label htmlFor="reset-again">{S.resetConfirmLabel}</label>
          <Input
            id="reset-again"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            disabled={done}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </div>
        {needCode && !done && (
          <div className="ui-field">
            <label htmlFor="reset-code">{S.resetCodeLabel}</label>
            <Input
              id="reset-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        {note && <p role={note.ok ? "status" : "alert"}>{note.text}</p>}
        {done ? (
          <Link to="/dashboard" className="db-entry-submit">
            {S.resetToDashboard}
          </Link>
        ) : (
          <Button type="submit" disabled={busy} className="db-entry-submit">
            {S.resetSave}
          </Button>
        )}
      </form>
    </Card>
  );
}
