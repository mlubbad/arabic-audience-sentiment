import { useStrings } from "./strings";
import { useImpersonation } from "./impersonation";

export function ImpersonationBanner() {
  const S = useStrings();
  const { isImpersonating, impersonatedUser, stopImpersonation, loading } =
    useImpersonation();

  if (!isImpersonating || !impersonatedUser) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="app-impersonation-banner"
      data-testid="impersonation-banner"
    >
      <div className="app-impersonation-info">
        <span className="app-impersonation-badge" aria-hidden="true">
          🎭 {S.adminImpersonationBadge}
        </span>
        <span className="app-impersonation-message">
          {S.adminImpersonationBanner(
            impersonatedUser.email ?? impersonatedUser.id,
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void stopImpersonation()}
        disabled={loading}
        className="ui-btn ui-btn--sm app-impersonation-return-btn"
        data-testid="impersonation-return-btn"
      >
        {loading ? S.adminImpersonateStopping : S.adminImpersonationReturn}
      </button>
    </aside>
  );
}
