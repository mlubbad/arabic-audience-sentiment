import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  completePendingConnection,
  connectResult,
  type PendingCompletion,
} from "./connectResult";
import { useStrings } from "./strings";

/** Where Google's callback hands the person back, inside the product. */
export function Connected() {
  const [params] = useSearchParams();
  const S = useStrings();
  const [completion, setCompletion] = useState<PendingCompletion | null>(null);
  const started = useRef(false);
  const ticket =
    params.get("connect") === "pending" ? params.get("ticket") : null;
  useEffect(() => {
    if (params.get("connect") !== "pending" || started.current) return;
    started.current = true;
    void completePendingConnection(ticket ?? "").then(setCompletion);
  }, [params, ticket]);
  const result = connectResult(params, S, completion);
  return (
    <div className="app-state connect-result-page">
      <span className="app-state-symbol" aria-hidden="true">
        {result.tone === "success" ? "✓" : "!"}
      </span>
      <p className="app-eyebrow">{S.connectedEyebrow}</p>
      <h1>{result.heading}</h1>
      <div
        className="notice"
        data-testid="connect-result"
        data-tone={result.tone}
      >
        <p>{result.detail}</p>
      </div>
      <p>
        {result.action === "console" && (
          <a
            href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
            target="_blank"
            rel="noreferrer"
          >
            {S.enableApiLink}
          </a>
        )}
      </p>
      <div className="app-state-actions">
        <Link to="/account">{S.backToAccount}</Link>
        {result.tone === "success" && (
          <Link to="/dashboard">{S.openDashboard}</Link>
        )}
      </div>
    </div>
  );
}
