import { Link, useSearchParams } from "react-router";
import { connectResult } from "./connectResult";

/** Where Google's callback hands the person back, inside the product. */
export function Connected() {
  const [params] = useSearchParams();
  const result = connectResult(params);
  return (
    <div className="app-state connect-result-page">
      <span className="app-state-symbol" aria-hidden="true">
        {result.tone === "success" ? "✓" : "!"}
      </span>
      <p className="app-eyebrow">ربط قناة يوتيوب</p>
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
            افتح صفحة تفعيل YouTube Data API
          </a>
        )}
      </p>
      <div className="app-state-actions">
        <Link to="/account">العودة إلى الحساب</Link>
        {result.tone === "success" && (
          <Link to="/dashboard">فتح لوحة البيانات</Link>
        )}
      </div>
    </div>
  );
}
