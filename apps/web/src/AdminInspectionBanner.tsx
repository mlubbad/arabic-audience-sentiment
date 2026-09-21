import { Link } from "react-router";
import { useAdminInspection } from "./useAdminInspection";
import { useStrings } from "./strings";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";

export function AdminInspectionBanner() {
  const S = useStrings();
  const { isInspecting, workspaceName } = useAdminInspection();

  if (!isInspecting) return null;

  return (
    <div className="app-admin-inspection-banner" role="status">
      <div className="app-admin-inspection-info">
        <Badge tone="warning">{S.adminInspectionBadge}</Badge>
        <span>{S.adminInspectionBanner(workspaceName ?? "")}</span>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="app-admin-inspection-btn"
      >
        <Link to="/admin">{S.adminInspectionReturn}</Link>
      </Button>
    </div>
  );
}
