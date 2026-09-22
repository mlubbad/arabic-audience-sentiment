import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary caught an error]:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleExitImpersonation = () => {
    try {
      sessionStorage.removeItem("sentiment_impersonation_session");
    } catch {
      // ignore
    }
    window.location.href = "/admin/users";
  };

  private handleGoHome = () => {
    window.location.href = "/dashboard";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isImpersonating = Boolean(
        typeof window !== "undefined" &&
          sessionStorage.getItem("sentiment_impersonation_session"),
      );

      return (
        <div
          className="app-state"
          role="alert"
          style={{ margin: "2rem auto", maxWidth: "600px" }}
        >
          <span className="app-state-symbol" aria-hidden="true">
            ⚠
          </span>
          <span className="app-eyebrow">خطأ غير متوقع · Unexpected Error</span>
          <h1>حدث خطأ أثناء تحميل الصفحة</h1>
          <p>
            تعذر عرض محتوى هذه الصفحة بشكل صحيح. يمكنك المحاولة مرة أخرى أو
            العودة.
          </p>
          {this.state.error?.message && (
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "0.85rem",
                background: "rgba(0,0,0,0.05)",
                padding: "0.75rem",
                borderRadius: "4px",
                direction: "ltr",
                textAlign: "left",
                margin: "1rem 0",
                wordBreak: "break-all",
              }}
            >
              {this.state.error.message}
            </div>
          )}
          <div
            className="app-state-actions"
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <Button type="button" variant="primary" onClick={this.handleReset}>
              إعادة تحميل الصفحة
            </Button>
            {isImpersonating && (
              <Button
                type="button"
                variant="danger"
                onClick={this.handleExitImpersonation}
              >
                إنهاء المحاكاة والعودة لحساب المدير
              </Button>
            )}
            <Button type="button" variant="outline" onClick={this.handleGoHome}>
              العودة للرئيسية
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
