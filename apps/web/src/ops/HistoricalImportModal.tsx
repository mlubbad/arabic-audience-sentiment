/**
 * Historical Data Backfill & Import Modal.
 *
 * Supports omnichannel historical post/video and comment ingestion:
 * 1. Platform-direct historical sync (YouTube/Telegram) capped by plan's historical days limit.
 * 2. External CSV / JSON file upload with column auto-mapping, quota verification, caps enforcement, and preview.
 */
import { useMemo, useRef, useState } from "react";
import type { UsageSummary } from "@sentiment/contracts";
import { supabase } from "../supabase";
import { useLocale } from "../locale";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";
import {
  generateSampleCsvTemplate,
  parseHistoricalFileAsync,
  MAX_HISTORICAL_FILE_SIZE,
  MAX_HISTORICAL_COMMENTS,
  type ParseResult,
} from "./historicalCsvJson";
import "./ops.css";

export function HistoricalImportModal({
  open,
  onClose,
  workspaceId,
  channelId,
  platform,
  plan,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  channelId: string | null;
  platform?: string | null;
  plan: UsageSummary | null;
  onSuccess: () => void;
}) {
  const S = useStrings();
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<"platform" | "file">("platform");

  // Plan limits calculation
  const backfillBudget = useMemo(() => {
    return plan?.budgets.find((b) => b.event_type === "historical_backfill");
  }, [plan]);

  const rawDaysLimit = plan?.plan?.historical_days_limit;
  const isUnlimitedDays =
    rawDaysLimit === null ||
    rawDaysLimit === undefined ||
    rawDaysLimit === -1 ||
    plan?.plan_key === "owner";
  const maxDaysLimit = isUnlimitedDays ? -1 : rawDaysLimit;

  const rawBackfillUnits = plan?.plan?.backfill_units;
  const isUnlimitedBackfill =
    rawBackfillUnits === null ||
    rawBackfillUnits === -1 ||
    plan?.plan_key === "owner";
  const remainingQuota = isUnlimitedBackfill
    ? -1
    : backfillBudget
      ? backfillBudget.remaining
      : (rawBackfillUnits ?? 0);

  // Platform sync form state
  const [daysBack, setDaysBack] = useState<number>(
    maxDaysLimit > 0 ? Math.min(30, maxDaysLimit) : 30,
  );
  const [maxItems, setMaxItems] = useState<number>(50);
  const [publishedAfter, setPublishedAfter] = useState<string>("");
  const [isSubmittingSync, setIsSubmittingSync] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    msg: string;
    tone: "success" | "error";
  } | null>(null);

  // File import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [fileFeedback, setFileFeedback] = useState<{
    msg: string;
    tone: "success" | "error";
  } | null>(null);

  // Reset states on close
  function handleClose() {
    setSyncFeedback(null);
    setFileFeedback(null);
    setFileName(null);
    setParseResult(null);
    setIsParsingFile(false);
    onClose();
  }

  // Handle live platform sync submit
  async function handleSubmitSync(e: React.FormEvent) {
    e.preventDefault();
    if (!channelId || !supabase) return;

    if (maxDaysLimit > 0 && daysBack > maxDaysLimit) {
      setSyncFeedback({
        msg: S.historicalDaysLimitNotice(maxDaysLimit),
        tone: "error",
      });
      return;
    }

    setIsSubmittingSync(true);
    setSyncFeedback(null);

    try {
      const { data, error } = await supabase.rpc(
        "request_historical_platform_sync",
        {
          w: workspaceId,
          p_channel_id: channelId,
          p_days_back: daysBack,
          p_max_items: maxItems,
          p_published_after: publishedAfter
            ? new Date(publishedAfter).toISOString()
            : null,
        },
      );

      if (error) {
        let msg = S.historicalSyncFailed;
        const errText = error.message || "";
        if (errText.includes("historical_sync_not_allowed_on_plan")) {
          msg = S.historicalSyncPlanNotAllowed;
        } else if (errText.includes("date_beyond_plan_limit")) {
          msg =
            maxDaysLimit > 0
              ? S.historicalDateBeyondPlanLimit(maxDaysLimit)
              : S.historicalSyncFailed;
        } else if (errText.includes("quota_exceeded")) {
          msg = S.historicalImportQuotaExceeded;
        } else if (errText.includes("channel_not_found")) {
          msg = S.historicalChannelNotFound;
        } else if (errText.includes("forbidden")) {
          msg = S.historicalForbidden;
        }
        setSyncFeedback({ msg, tone: "error" });
      } else {
        const res = data as { ok: boolean; job_id?: string; error?: string };
        if (res.ok) {
          setSyncFeedback({
            msg: S.historicalSyncQueued,
            tone: "success",
          });
          onSuccess();
          setTimeout(() => handleClose(), 1500);
        } else {
          setSyncFeedback({
            msg: res.error || S.historicalSyncFailed,
            tone: "error",
          });
        }
      }
    } catch (err: unknown) {
      setSyncFeedback({
        msg: err instanceof Error ? err.message : S.historicalSyncFailed,
        tone: "error",
      });
    } finally {
      setIsSubmittingSync(false);
    }
  }

  // Handle file selection
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Immediately clear previous parse state and feedback
    setFileName(file.name);
    setParseResult(null);
    setFileFeedback(null);

    // Enforce file size limit immediately before reading
    if (file.size > MAX_HISTORICAL_FILE_SIZE) {
      setFileFeedback({
        msg: S.historicalFileTooLarge,
        tone: "error",
      });
      return;
    }

    setIsParsingFile(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = String(event.target?.result || "");
        // Parse off main thread using async chunked parser
        const parsed = await parseHistoricalFileAsync(content, file.name);
        setParseResult(parsed);
        if (!parsed.ok) {
          let errorMsg = S.historicalFileInvalid;
          if (parsed.error === "file_too_large") {
            errorMsg = S.historicalFileTooLarge;
          } else if (parsed.error === "batch_too_large") {
            errorMsg = S.historicalBatchTooLarge;
          }
          setFileFeedback({
            msg: errorMsg,
            tone: "error",
          });
        }
      } catch {
        setFileFeedback({
          msg: S.historicalFileInvalid,
          tone: "error",
        });
      } finally {
        setIsParsingFile(false);
      }
    };
    reader.onerror = () => {
      setIsParsingFile(false);
      setFileFeedback({
        msg: S.historicalFileInvalid,
        tone: "error",
      });
    };
    reader.readAsText(file);
  }

  // Download sample CSV template
  function handleDownloadTemplate() {
    const template = generateSampleCsvTemplate();
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_historical_import.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Handle file import submit
  async function handleSubmitFileImport(e: React.FormEvent) {
    e.preventDefault();
    if (!channelId || !supabase || !parseResult?.payload) return;

    const commentsCount = parseResult.payload.comments.length;
    if (commentsCount > MAX_HISTORICAL_COMMENTS) {
      setFileFeedback({
        msg: S.historicalBatchTooLarge,
        tone: "error",
      });
      return;
    }

    if (remainingQuota !== -1 && commentsCount > remainingQuota) {
      setFileFeedback({
        msg: S.historicalImportQuotaExceeded,
        tone: "error",
      });
      return;
    }

    setIsImportingFile(true);
    setFileFeedback(null);

    try {
      const { data, error } = await supabase.rpc("import_historical_records", {
        w: workspaceId,
        p_channel_id: channelId,
        p_payload: parseResult.payload,
      });

      if (error) {
        let msg = S.historicalImportFailed;
        const errText = error.message || "";
        if (errText.includes("batch_too_large")) {
          msg = S.historicalBatchTooLarge;
        } else if (errText.includes("file_too_large")) {
          msg = S.historicalFileTooLarge;
        } else if (errText.includes("historical_sync_not_allowed_on_plan")) {
          msg = S.historicalSyncPlanNotAllowed;
        } else if (errText.includes("date_beyond_plan_limit")) {
          msg =
            maxDaysLimit > 0
              ? S.historicalDateBeyondPlanLimit(maxDaysLimit)
              : S.historicalImportFailed;
        } else if (errText.includes("quota_exceeded")) {
          msg = S.historicalImportQuotaExceeded;
        } else if (errText.includes("channel_not_found")) {
          msg = S.historicalChannelNotFound;
        } else if (errText.includes("forbidden")) {
          msg = S.historicalForbidden;
        } else if (errText.includes("invalid_payload")) {
          msg = S.historicalInvalidPayload;
        }
        setFileFeedback({ msg, tone: "error" });
      } else {
        const res = data as {
          ok: boolean;
          posts_count: number;
          comments_count: number;
          backfill_units_used: number;
          backfill_units_remaining: number;
          error?: string;
        };
        if (res.ok) {
          setFileFeedback({
            msg: S.historicalImportSuccess(res.posts_count, res.comments_count),
            tone: "success",
          });
          onSuccess();
          setTimeout(() => handleClose(), 1600);
        } else {
          let msg = res.error || S.historicalImportFailed;
          if (res.error?.includes("batch_too_large")) {
            msg = S.historicalBatchTooLarge;
          }
          setFileFeedback({
            msg,
            tone: "error",
          });
        }
      }
    } catch (err: unknown) {
      setFileFeedback({
        msg: err instanceof Error ? err.message : S.historicalImportFailed,
        tone: "error",
      });
    } finally {
      setIsImportingFile(false);
    }
  }

  const quotaLabel =
    remainingQuota === -1
      ? S.pricingUnlimited
      : remainingQuota.toLocaleString();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        closeLabel={locale === "ar" ? "إغلاق" : "Close"}
        className="db-historical-dialog"
      >
        <DialogTitle>{S.historicalImportTitle}</DialogTitle>
        <DialogDescription>{S.historicalImportLead}</DialogDescription>

        {/* Quota Banner */}
        <div className="db-historical-quota-banner">
          <div>
            <strong>{S.budgetBackfill}: </strong>
            <Badge tone={remainingQuota === 0 ? "danger" : "neutral"}>
              {quotaLabel}
            </Badge>
          </div>
          <div>
            <span>
              {maxDaysLimit === -1
                ? S.pricingUnlimited
                : S.historicalDaysLimitNotice(maxDaysLimit)}
            </span>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="db-historical-tabs">
          <button
            type="button"
            onClick={() => setActiveTab("platform")}
            className={`db-historical-tab ${activeTab === "platform" ? "is-active" : ""}`}
            data-testid="tab-platform-sync"
          >
            {platform
              ? `${S.historicalTabPlatform} (${platform})`
              : S.historicalTabPlatform}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("file")}
            className={`db-historical-tab ${activeTab === "file" ? "is-active" : ""}`}
            data-testid="tab-file-import"
          >
            {S.historicalTabFile}
          </button>
        </div>

        {/* TAB 1: Platform Direct Sync */}
        {activeTab === "platform" && (
          <form onSubmit={handleSubmitSync} className="db-historical-form">
            {syncFeedback && (
              <div
                role="alert"
                className="db-historical-feedback"
                data-tone={syncFeedback.tone}
              >
                {syncFeedback.msg}
              </div>
            )}

            <label>
              <strong>{S.historicalDaysBack}</strong>
              <Input
                type="number"
                min={1}
                value={daysBack || ""}
                onChange={(e) =>
                  setDaysBack(
                    e.target.value === ""
                      ? 0
                      : parseInt(e.target.value, 10) || 0,
                  )
                }
                required
                data-testid="input-days-back"
              />
              <small className="db-muted">
                {maxDaysLimit > 0
                  ? S.historicalDaysLimitNotice(maxDaysLimit)
                  : S.pricingUnlimited}
              </small>
            </label>

            <label>
              <strong>{S.historicalMaxItems}</strong>
              <Input
                type="number"
                min={1}
                max={500}
                value={maxItems}
                onChange={(e) => setMaxItems(parseInt(e.target.value, 10) || 1)}
                required
                data-testid="input-max-items"
              />
            </label>

            <label>
              <strong>{S.historicalStartDate}</strong>
              <Input
                type="date"
                value={publishedAfter}
                onChange={(e) => setPublishedAfter(e.target.value)}
                data-testid="input-published-after"
              />
            </label>

            <div className="db-historical-dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={isSubmittingSync}
              >
                {locale === "ar" ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  isSubmittingSync || !channelId || remainingQuota === 0
                }
                data-testid="btn-submit-sync"
              >
                {isSubmittingSync
                  ? S.historicalStartingSync
                  : S.historicalStartSync}
              </Button>
            </div>
          </form>
        )}

        {/* TAB 2: File Import (CSV/JSON) */}
        {activeTab === "file" && (
          <form
            onSubmit={handleSubmitFileImport}
            className="db-historical-form"
          >
            {fileFeedback && (
              <div
                role="alert"
                className="db-historical-feedback"
                data-tone={fileFeedback.tone}
              >
                {fileFeedback.msg}
              </div>
            )}

            <div
              className="db-historical-dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                style={{ display: "none" }}
                onChange={handleFileChange}
                data-testid="input-file-import"
              />
              <p className="db-historical-dropzone-filename">
                {isParsingFile
                  ? S.historicalParsingFile
                  : fileName
                    ? fileName
                    : S.historicalFileDropzone}
              </p>
              <p className="db-historical-dropzone-caps">
                {S.historicalFileCapsHint(5, 1000)}
              </p>
            </div>

            <div className="db-historical-file-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDownloadTemplate}
                data-testid="btn-download-template"
              >
                📥 {S.historicalDownloadCsvTemplate}
              </Button>

              {parseResult?.ok && parseResult.summary && (
                <div className="db-historical-file-counts">
                  <span>
                    {S.historicalPreviewPostsCount(
                      parseResult.summary.postsCount,
                    )}
                  </span>{" "}
                  •{" "}
                  <span>
                    {S.historicalPreviewCommentsCount(
                      parseResult.summary.commentsCount,
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Preview Box */}
            {parseResult?.ok &&
              parseResult.payload &&
              parseResult.payload.comments.length > 0 && (
                <div className="db-historical-preview">
                  <div className="db-historical-preview-title">
                    {S.historicalPreviewTitle}
                  </div>
                  {parseResult.payload.comments.slice(0, 3).map((c, i) => (
                    <div key={i} className="db-historical-preview-row">
                      <strong>{c.author_name || "Anonymous"}: </strong>
                      <span>{c.text_raw}</span>
                    </div>
                  ))}
                </div>
              )}

            <div className="db-historical-dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={isImportingFile || isParsingFile}
              >
                {locale === "ar" ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  isImportingFile ||
                  isParsingFile ||
                  !channelId ||
                  !parseResult?.ok ||
                  (remainingQuota !== -1 &&
                    (parseResult?.payload?.comments.length ?? 0) >
                      remainingQuota)
                }
                data-testid="btn-submit-file-import"
              >
                {isImportingFile
                  ? S.historicalImporting
                  : S.historicalStartImport}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
