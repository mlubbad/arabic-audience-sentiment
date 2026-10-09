/**
 * `/reset-password`: the way back for a person who forgot their password,
 * and where the link the owner sends from the account file lands.
 *
 * Two screens, chosen by whether a session is present:
 * - signed out: the email form. Supabase's `/recover` sends the link; the
 *   answer is the same whether the email has an account or not, so the page
 *   never tells a stranger who is registered;
 * - signed in (the link signed them in, as `type=recovery`): the new
 *   password, twice, through `auth.updateUser`.
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
          <SetPassword />
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

function SetPassword() {
  const S = useStrings();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password !== again) {
      setNote({ ok: false, text: S.resetMismatch });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setNote({ ok: false, text: S.resetFailed });
      else {
        setDone(true);
        setNote({ ok: true, text: S.resetDone });
      }
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
        <div className="ui-field">
          <label htmlFor="reset-new">{S.resetNewLabel}</label>
          <Input
            id="reset-new"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={done}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="reset-again">{S.resetConfirmLabel}</label>
          <Input
            id="reset-again"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={done}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </div>
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
