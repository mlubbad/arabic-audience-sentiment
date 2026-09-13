import { Link, useSearchParams } from "react-router";
import { connectResult } from "./connectResult";

/** Where Google's callback hands the person back, inside the product. */
export function Connected() {
  const [params] = useSearchParams();
  const result = connectResult(params);
  return (
    <>
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
      <p>
        <Link to="/account">العودة إلى الحساب</Link>
        {result.tone === "success" && (
          <>
            {" · "}
            <Link to="/dashboard">فتح اللوحة</Link>
          </>
        )}
      </p>
    </>
  );
}
