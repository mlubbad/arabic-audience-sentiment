/**
 * Admin System & Third-Party Services Health Observability Dashboard.
 *
 * Displays health indicators, response latencies, quota consumption, and
 * diagnostics across all 15 third-party and internal dependencies.
 * Supports configurable auto-refresh with countdown and local persistence.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ServiceCategory,
  ServiceHealthItem,
  ServiceStatus,
} from "@sentiment/contracts";
import { useStrings } from "../strings";
import { failureCode } from "../failure";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import { BudgetMeter } from "../ui/BudgetMeter";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";
import { Input } from "../ui/Input";
import { readAdminServicesHealth } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";

const REFRESH_STORAGE_KEY = "sentiment_admin_health_refresh_interval";
const DEFAULT_INTERVAL_MS = 30000; // 30s recommended default

export function AdminServicesPage() {
  const S = useStrings();
  const searchInputId = useId();
  const { admin, shell } = useAdminShell();
  const wantsDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");

  // Retrieve stored refresh preference or fallback to recommended 30s
  const [intervalMs, setIntervalMs] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_INTERVAL_MS;
    const stored = window.localStorage.getItem(REFRESH_STORAGE_KEY);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && [0, 10000, 30000, 60000, 300000].includes(parsed)) {
        return parsed;
      }
    }
    return DEFAULT_INTERVAL_MS;
  });

  // Track remaining countdown seconds
  const [countdown, setCountdown] = useState<number>(
    intervalMs > 0 ? Math.round(intervalMs / 1000) : 0,
  );

  // Filters & Selected Dialog Item
  const [selectedStatus, setSelectedStatus] = useState<ServiceStatus | "all">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [inspectingService, setInspectingService] =
    useState<ServiceHealthItem | null>(null);

  const query = useQuery({
    queryKey: ["admin", "services", wantsDemo],
    queryFn: () => readAdminServicesHealth({ isDemo: wantsDemo }),
    enabled: admin,
    refetchInterval: intervalMs > 0 ? intervalMs : false,
  });

  // Handle interval selection & storage
  const handleIntervalChange = (val: number) => {
    setIntervalMs(val);
    setCountdown(val > 0 ? Math.round(val / 1000) : 0);
    try {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, String(val));
    } catch {
      // Storage unavailable or disabled
    }
  };

  // Countdown timer loop
  useEffect(() => {
    if (intervalMs <= 0) {
      setCountdown(0);
      return;
    }

    setCountdown(Math.round(intervalMs / 1000));
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return Math.round(intervalMs / 1000);
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [intervalMs, query.dataUpdatedAt]);

  const report = query.data;

  // Filtered services
  const filteredServices = useMemo(() => {
    if (!report?.services) return [];
    const q = searchQuery.trim().toLowerCase();
    return report.services.filter((item) => {
      if (selectedStatus !== "all" && item.status !== selectedStatus) {
        return false;
      }
      if (!q) return true;
      return (
        item.name_ar.toLowerCase().includes(q) ||
        item.name_en.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.endpoint && item.endpoint.toLowerCase().includes(q))
      );
    });
  }, [report, selectedStatus, searchQuery]);

  // Group services by category
  const categories = useMemo(() => {
    const list = filteredServices;
    const allCats: { key: ServiceCategory; title: string }[] = [
      { key: "infrastructure", title: S.adminServicesCatInfrastructure },
      { key: "ai_engine", title: S.adminServicesCatAi },
      { key: "data_ingestion", title: S.adminServicesCatIngestion },
      { key: "billing", title: S.adminServicesCatBilling },
    ];
    return allCats
      .map((cat) => ({
        key: cat.key,
        title: cat.title,
        items: list.filter((s) => s.category === cat.key),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [filteredServices, S]);

  // Status formatters
  const statusTone = (status: ServiceStatus) => {
    switch (status) {
      case "healthy":
        return "success";
      case "degraded":
        return "warning";
      case "down":
        return "danger";
      case "unconfigured":
      default:
        return "neutral";
    }
  };

  const statusLabel = (status: ServiceStatus) => {
    switch (status) {
      case "healthy":
        return S.adminServicesFilterHealthy;
      case "degraded":
        return S.adminServicesFilterDegraded;
      case "down":
        return S.adminServicesFilterDown;
      case "unconfigured":
        return S.adminServicesFilterUnconfigured;
    }
  };

  let body: ReactNode;
  if (!admin) {
    body = null;
  } else if (query.isPending) {
    body = <Loading S={S} label={S.adminServicesLoading} shape="ops" />;
  } else if (query.isError) {
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!report) {
    body = (
      <ChartEmpty testId="admin-services-empty">
        {S.adminServicesEmpty}
      </ChartEmpty>
    );
  } else {
    const totalCount = report.services.length;
    const healthyCount = report.services.filter(
      (s) => s.status === "healthy",
    ).length;
    const degradedCount = report.services.filter(
      (s) => s.status === "degraded",
    ).length;
    const downCount = report.services.filter((s) => s.status === "down").length;
    const unconfiguredCount = report.services.filter(
      (s) => s.status === "unconfigured",
    ).length;

    // Relative seconds ago
    const secondsSinceUpdate = Math.max(
      0,
      Math.round((Date.now() - (query.dataUpdatedAt || Date.now())) / 1000),
    );

    const relativeTimeStr =
      secondsSinceUpdate < 5
        ? S.adminServicesJustNow
        : secondsSinceUpdate < 60
          ? S.adminServicesSecondsAgo(secondsSinceUpdate)
          : S.adminServicesMinutesAgo(Math.floor(secondsSinceUpdate / 60));

    body = (
      <div className="admin-services-page" data-testid="admin-services-page">
        {/* Auto-Refresh Toolbar */}
        <section
          className="admin-services-toolbar"
          aria-label={S.adminServicesRefreshLabel}
        >
          <div className="admin-services-controls">
            <div className="admin-services-interval-group">
              <label
                htmlFor="admin-refresh-select"
                className="admin-services-label"
              >
                {S.adminServicesRefreshLabel}:
              </label>
              <select
                id="admin-refresh-select"
                data-testid="admin-refresh-select"
                className="ui-select admin-services-select"
                value={intervalMs}
                onChange={(e) => handleIntervalChange(Number(e.target.value))}
                aria-label={S.adminServicesRefreshLabel}
              >
                <option value={10000}>{S.adminServicesRefresh10s}</option>
                <option value={30000}>{S.adminServicesRefresh30s}</option>
                <option value={60000}>{S.adminServicesRefresh1m}</option>
                <option value={300000}>{S.adminServicesRefresh5m}</option>
                <option value={0}>{S.adminServicesRefreshPaused}</option>
              </select>
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="admin-services-refresh-btn"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <span
                className={
                  query.isFetching ? "admin-spin-icon" : "admin-refresh-icon"
                }
                aria-hidden="true"
              >
                ⟳
              </span>
              {query.isFetching
                ? S.adminServicesRefreshing
                : S.adminServicesRefreshNow}
            </Button>
          </div>

          <div className="admin-services-pacing">
            {intervalMs > 0 && (
              <span
                className="admin-services-countdown"
                data-testid="admin-services-countdown"
              >
                {S.adminServicesNextRefresh(countdown)}
              </span>
            )}
            <span className="admin-services-last-checked">
              {S.adminServicesLastChecked(relativeTimeStr)}
            </span>
          </div>
        </section>

        {/* Hero KPI Cards */}
        <section
          className="admin-services-kpis"
          aria-label={S.adminServicesKpiOverall}
        >
          <Card className="admin-services-kpi-card">
            <span className="admin-services-kpi-caption">
              {S.adminServicesKpiOverall}
            </span>
            <div className="admin-services-kpi-val">
              <span
                className={`admin-status-dot admin-status-dot--${report.overall_status}`}
                aria-hidden="true"
              />
              <b>{statusLabel(report.overall_status)}</b>
            </div>
            <small className="admin-services-kpi-sub">
              {report.overall_status === "healthy"
                ? S.adminServicesStatusHealthySentence
                : report.overall_status === "degraded"
                  ? S.adminServicesStatusDegradedSentence
                  : S.adminServicesStatusDownSentence}
            </small>
          </Card>

          <Card className="admin-services-kpi-card">
            <span className="admin-services-kpi-caption">
              {S.adminServicesKpiServicesCount}
            </span>
            <div className="admin-services-kpi-val">
              <b className="ui-num">{totalCount}</b>
              <Badge tone="success" numeric>
                {healthyCount}
              </Badge>
              {degradedCount > 0 && (
                <Badge tone="warning" numeric>
                  {degradedCount}
                </Badge>
              )}
              {downCount > 0 && (
                <Badge tone="danger" numeric>
                  {downCount}
                </Badge>
              )}
            </div>
            <small className="admin-services-kpi-sub">
              {S.adminServicesServicesUnit(totalCount)}
            </small>
          </Card>

          <Card className="admin-services-kpi-card">
            <span className="admin-services-kpi-caption">
              {S.adminServicesKpiAvgLatency}
            </span>
            <div className="admin-services-kpi-val">
              <b className="ui-num">
                {report.summary.avg_latency_ms != null
                  ? Math.round(report.summary.avg_latency_ms)
                  : "--"}
              </b>
              <small>{S.adminServicesMsUnit}</small>
            </div>
            <small className="admin-services-kpi-sub">
              {healthyCount} / {totalCount} {S.adminServicesFilterHealthy}
            </small>
          </Card>

          <Card className="admin-services-kpi-card">
            <span className="admin-services-kpi-caption">
              {S.adminServicesKpiQuotaAlerts}
            </span>
            <div className="admin-services-kpi-val">
              <b className="ui-num">
                {
                  report.services.filter(
                    (s) =>
                      s.quota_used != null &&
                      s.quota_total != null &&
                      s.quota_used / s.quota_total > 0.8,
                  ).length
                }
              </b>
              <small>تنبيهات استهلاك</small>
            </div>
            <small className="admin-services-kpi-sub">
              YouTube Data API و Apify Scraper
            </small>
          </Card>
        </section>

        {/* Filter and Search Bar */}
        <section className="admin-services-filter-bar">
          <div
            className="admin-services-pills"
            role="group"
            aria-label="تصفية حسب الحالة"
          >
            <button
              type="button"
              className={`admin-services-pill ${selectedStatus === "all" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("all")}
            >
              {S.adminServicesFilterAll} ({totalCount})
            </button>
            <button
              type="button"
              className={`admin-services-pill ${selectedStatus === "healthy" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("healthy")}
            >
              <span className="admin-status-dot admin-status-dot--healthy" />
              {S.adminServicesFilterHealthy} ({healthyCount})
            </button>
            <button
              type="button"
              className={`admin-services-pill ${selectedStatus === "degraded" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("degraded")}
            >
              <span className="admin-status-dot admin-status-dot--degraded" />
              {S.adminServicesFilterDegraded} ({degradedCount})
            </button>
            {downCount > 0 && (
              <button
                type="button"
                className={`admin-services-pill ${selectedStatus === "down" ? "is-active" : ""}`}
                onClick={() => setSelectedStatus("down")}
              >
                <span className="admin-status-dot admin-status-dot--down" />
                {S.adminServicesFilterDown} ({downCount})
              </button>
            )}
            {unconfiguredCount > 0 && (
              <button
                type="button"
                className={`admin-services-pill ${selectedStatus === "unconfigured" ? "is-active" : ""}`}
                onClick={() => setSelectedStatus("unconfigured")}
              >
                {S.adminServicesFilterUnconfigured} ({unconfiguredCount})
              </button>
            )}
          </div>

          <div className="admin-services-search">
            <Input
              id={searchInputId}
              type="search"
              placeholder={S.adminServicesSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={S.adminServicesSearchPlaceholder}
            />
          </div>
        </section>

        {/* Categorized Services List */}
        {categories.length === 0 ? (
          <ChartEmpty testId="admin-services-no-match">
            {S.adminServicesEmpty}
          </ChartEmpty>
        ) : (
          categories.map((cat) => (
            <section
              key={cat.key}
              className="db-section admin-services-category-section"
            >
              <header className="admin-services-cat-head">
                <h2>{cat.title}</h2>
                <Badge tone="neutral" numeric>
                  {cat.items.length}
                </Badge>
              </header>

              <div className="admin-services-grid">
                {cat.items.map((svc) => {
                  const hasQuota =
                    svc.quota_used != null && svc.quota_total != null;
                  const quotaPct = hasQuota
                    ? Math.round((svc.quota_used! / svc.quota_total!) * 100)
                    : 0;

                  return (
                    <Card
                      key={svc.id}
                      className="admin-service-card"
                      data-status={svc.status}
                    >
                      <header className="admin-service-card-head">
                        <div className="admin-service-identity">
                          <h3 className="admin-service-title">{svc.name_ar}</h3>
                          <span className="admin-service-id">{svc.id}</span>
                        </div>
                        <Badge tone={statusTone(svc.status)}>
                          <span
                            className={`admin-status-dot admin-status-dot--${svc.status}`}
                            aria-hidden="true"
                          />
                          {statusLabel(svc.status)}
                        </Badge>
                      </header>

                      <div className="admin-service-metrics">
                        <div className="admin-service-metric-row">
                          <span className="admin-service-metric-label">
                            {S.adminServicesLatency}:
                          </span>
                          <span className="admin-service-metric-value ui-num">
                            {svc.latency_ms != null
                              ? `${svc.latency_ms} ${S.adminServicesMsUnit}`
                              : "--"}
                          </span>
                        </div>

                        {hasQuota ? (
                          <div className="admin-service-quota-box">
                            <BudgetMeter
                              used={svc.quota_used!}
                              allowance={svc.quota_total!}
                              state={
                                quotaPct >= 90
                                  ? "critical"
                                  : quotaPct >= 70
                                    ? "warning"
                                    : "ok"
                              }
                              label={svc.name_ar}
                              sentence={`${svc.quota_used!.toLocaleString()} / ${svc.quota_total!.toLocaleString()} ${svc.quota_unit || ""}`}
                              testId={`quota-${svc.id}`}
                            />
                          </div>
                        ) : (
                          <div className="admin-service-no-quota">
                            <small>{S.adminServicesNoQuota}</small>
                          </div>
                        )}
                      </div>

                      <p className="admin-service-details">{svc.details}</p>

                      <footer className="admin-service-card-foot">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setInspectingService(svc)}
                        >
                          {S.adminServicesDetailsBtn}
                        </Button>
                      </footer>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}

        {/* Technical Diagnostics Dialog */}
        <Dialog
          open={inspectingService !== null}
          onOpenChange={(open) => {
            if (!open) setInspectingService(null);
          }}
        >
          {inspectingService && (
            <DialogContent closeLabel={S.adminServicesDialogClose}>
              <DialogTitle>{S.adminServicesDialogTitle}</DialogTitle>
              <DialogDescription>
                {inspectingService.name_ar} ({inspectingService.name_en})
              </DialogDescription>

              <div className="admin-dialog-details-body">
                <div className="admin-dialog-field">
                  <span className="admin-dialog-field-label">
                    {S.adminServicesDialogStatus}:
                  </span>
                  <Badge tone={statusTone(inspectingService.status)}>
                    {statusLabel(inspectingService.status)}
                  </Badge>
                </div>

                {inspectingService.endpoint && (
                  <div className="admin-dialog-field">
                    <span className="admin-dialog-field-label">
                      {S.adminServicesDialogEndpoint}:
                    </span>
                    <code className="admin-dialog-code">
                      {inspectingService.endpoint}
                    </code>
                  </div>
                )}

                <div className="admin-dialog-field">
                  <span className="admin-dialog-field-label">
                    {S.adminServicesDialogLatency}:
                  </span>
                  <span className="ui-num">
                    {inspectingService.latency_ms != null
                      ? `${inspectingService.latency_ms} ${S.adminServicesMsUnit}`
                      : "--"}
                  </span>
                </div>

                <div className="admin-dialog-field">
                  <span className="admin-dialog-field-label">
                    {S.adminServicesDialogDetails}:
                  </span>
                  <p className="admin-dialog-text">
                    {inspectingService.details}
                  </p>
                </div>

                {inspectingService.error_code && (
                  <div className="admin-dialog-field admin-dialog-field--danger">
                    <span className="admin-dialog-field-label">
                      {S.adminServicesDialogErrorCode}:
                    </span>
                    <code>{inspectingService.error_code}</code>
                  </div>
                )}

                {inspectingService.remediation && (
                  <div className="admin-dialog-field admin-dialog-field--warning">
                    <span className="admin-dialog-field-label">
                      {S.adminServicesDialogRemediation}:
                    </span>
                    <p className="admin-dialog-text">
                      {inspectingService.remediation}
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          )}
        </Dialog>
      </div>
    );
  }

  return shell(
    <>
      <AdminPageHead title={S.adminServicesTitle} lead={S.adminServicesLead} />
      {body}
    </>,
  );
}
