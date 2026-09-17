/**
 * The way in: what a signed-out reader sees on the account page.
 *
 * Two screens, not one form with two submits. Logging in and creating an
 * account are different intentions with different stakes, and a single form
 * that did both put them on adjacent buttons — so the way to a new account
 * and the way back into an existing one were one mis-click apart. Which of
 * the two is showing is this component's own state (`joining`), as are the
 * two fields; the page owns the session, the client and the messages, so
 * the submit hands up an action and the credentials and the page answers
 * through `feedback`.
 *
 * Recomposed on `ui/` (phase 5): the form as a `Card`, `Input`s, the submit
 * `Button`, the providers as outline `Button`s, the switch as a link
 * `Button`; the story and the trust panel as two more `Card`s beside it.
 * The markup contract the static test reads — `data-provider`, the
 * `id="why-*"` sentences, `aria-describedby` on a closed door, the
 * `value="signin" | "signup"` the submit handler reads back — is the one the
 * page always had. Google One Tap mounts here, with the page's own gate.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { AuthAction } from "../authMessages";
import type { Provider, ProviderId } from "../authProviders";
import { useGoogleOneTap } from "../googleOneTap";
import { setupSteps } from "../setup";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import "../pages.css";
import "./account.css";

export function AuthEntry({
  providers,
  busy,
  feedback,
  oneTap,
  onAuth,
  onProvider,
  onSwitch,
}: {
  /** Every door, open or closed, in the order they are offered. */
  providers: Provider[];
  /** Something on the page is in flight: the form and every door wait. */
  busy: boolean;
  /** The page's answer to the last submit or door — its `feedback("auth")`. */
  feedback: ReactNode;
  /** The One Tap gate and handler the page always passed to the hook;
   *  `enabled` is ANDed here with "the Google door is actually open". */
  oneTap: Parameters<typeof useGoogleOneTap>[0];
  onAuth: (
    action: AuthAction,
    creds: { email: string; password: string },
  ) => Promise<void>;
  /** A door was pressed. The page checks it is open before it leaves. */
  onProvider: (id: ProviderId) => void;
  /** The reader moved between the two screens; the page drops its note. */
  onSwitch: () => void;
}) {
  const S = useStrings();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  // Which of the two screens is showing. A query string so the header's
  // "تسجيل الدخول" and a "create an account" link can each land on the right
  // one, and so a reader can send someone the signup screen directly.
  const [joining, setJoining] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("signup"),
  );
  const googleOpen = providers.some(
    (p) => p.id === "google" && !p.closedReason,
  );
  useGoogleOneTap({ ...oneTap, enabled: oneTap.enabled && googleOpen });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const action: AuthAction =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "signup"
        ? "signup"
        : "signin";
    void onAuth(action, { email, password });
  }

  return (
    <div className="db-grid db-grid--entry">
      <Card asChild className="db-entry-form">
        <form onSubmit={submit}>
          <h2>{joining ? S.authJoinTitle : S.authReturnTitle}</h2>
          <p className="db-lead">
            {joining ? S.authJoinLead : S.authReturnLead}
          </p>
          <div className="ui-field">
            <label htmlFor="auth-email">{S.emailLabel}</label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="auth-password">{S.passwordLabel}</label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={joining ? "new-password" : "current-password"}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {feedback}
          <Button
            type="submit"
            name="action"
            value={joining ? "signup" : "signin"}
            disabled={busy}
            className="db-entry-submit"
          >
            {joining ? S.createAccount : S.signIn}
          </Button>

          <p className="db-or">
            <span>{joining ? S.orJoinWith : S.orSignInWith}</span>
          </p>
          {/* Every door is shown, and the closed ones say they are closed.
              Hiding them would leave a reader who came expecting Google
              wondering whether they misremembered; offering them live would
              spend their one moment of intent on an error. */}
          <ul className="db-providers" role="list">
            {providers.map((p) => (
              <li key={p.id}>
                <Button
                  variant="outline"
                  data-provider={p.id}
                  disabled={!!p.closedReason || busy}
                  aria-describedby={p.closedReason ? `why-${p.id}` : undefined}
                  onClick={() => onProvider(p.id)}
                >
                  {p.label}
                </Button>
                {p.closedReason && (
                  <small id={`why-${p.id}`}>{p.closedReason}</small>
                )}
              </li>
            ))}
          </ul>

          <p className="db-switch">
            {joining ? S.haveAccount : S.noAccount}{" "}
            <Button
              variant="link"
              onClick={() => {
                setJoining(!joining);
                onSwitch();
              }}
            >
              {joining ? S.signIn : S.joinLink}
            </Button>
          </p>
        </form>
      </Card>
      <aside className="db-entry-aside">
        <Card className="db-entry-story">
          <Badge tone="neutral">{S.howToStartEyebrow}</Badge>
          <h2>{S.howToStartTitle}</h2>
          <p className="db-lead">{S.howToStartLead}</p>
          {/* The same three sentences the owner sees with a state on each,
              once signed in. Written once in `setup.ts`. */}
          <ol className="db-steps">
            {setupSteps.map((step) => (
              <li key={step.key}>{S[step.title]}</li>
            ))}
          </ol>
        </Card>

        {/* The reassurance panel, and the reason it says none of the things
            a panel like this usually says.

            The reference it is modelled on reads "Trusted by 200,000+
            companies in 120 countries" over five customer logos. We have no
            customers, so that line and those logos would be an invention —
            and on a product whose whole argument is that it reports what it
            measured, a fabricated number on the way in would undo the
            argument before the reader reaches the data.

            So the panel carries what is true and checkable instead. Each
            line is a property of the build, not a claim about a market, and
            each one is asserted by a test in this repository. */}
        <Card className="db-trust" data-testid="account-trust">
          <h3>{S.trustTitle}</h3>
          <ul>
            <li>
              <strong>{S.trustIsolationStrong}</strong>
              {S.trustIsolation}
            </li>
            <li>
              <strong>{S.trustCountedStrong}</strong>
              {S.trustCounted}
            </li>
            <li>
              <strong>{S.trustMeasuredStrong}</strong>
              {S.trustMeasured}
            </li>
            <li>
              <strong>{S.trustReviewStrong}</strong>
              {S.trustReview}
            </li>
          </ul>
          <p className="db-trust-note">{S.trustNote}</p>
        </Card>
      </aside>
    </div>
  );
}
