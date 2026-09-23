/**
 * Dialog for platform administrators to dynamically adjust subscription plan limits.
 *
 * Allows updating channels, analysis units, historical backfill quota, historical depth,
 * and data retention without needing database migrations or service redeploys.
 */
import { useState } from "react";
import type { Plan } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { useLocale } from "../locale";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/Dialog";
import { updatePlanLimits } from "./adminRead";

export function EditPlanLimitsDialog({
  plan,
  open,
  onClose,
  onSuccess,
}: {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const S = useStrings();
  const locale = useLocale();

  const [channels, setChannels] = useState<number>(plan?.limits.channels ?? 1);
  const [analysisUnits, setAnalysisUnits] = useState<number>(
    plan?.limits.analysis_units ?? 10000,
  );
  const [backfillUnits, setBackfillUnits] = useState<number>(
    plan?.backfill_units ?? 40000,
  );
  const [historicalDays, setHistoricalDays] = useState<number>(
    plan?.historical_days_limit ?? 30,
  );
  const [allowPublic, setAllowPublic] = useState<boolean>(
    plan?.allow_public_channels ?? false,
  );

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!plan) return null;

  const planName = locale === "ar" ? plan.title_ar : plan.title_en;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;

    setSaving(true);
    setErrorMsg(null);

    try {
      await updatePlanLimits(plan.key, {
        channels,
        analysis_units: analysisUnits,
        backfill_units: backfillUnits,
        historical_days_limit: historicalDays,
        allow_public_channels: allowPublic,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : S.adminPlanLimitsUpdateFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent closeLabel={locale === "ar" ? "إغلاق" : "Close"}>
        <DialogTitle>{S.adminPlanEditLimitsTitle}</DialogTitle>
        <DialogDescription>
          {planName} (<code>{plan.key}</code>)
        </DialogDescription>

        {errorMsg && (
          <div
            role="alert"
            className="db-channel-feedback"
            style={{ color: "var(--tone-danger)", margin: "var(--space-2) 0" }}
          >
            {errorMsg}
          </div>
        )}

        <form
          onSubmit={handleSave}
          style={{
            display: "grid",
            gap: "var(--space-3)",
            marginTop: "var(--space-3)",
          }}
        >
          <label>
            <strong>{S.adminPlanChannelsLimit}</strong>
            <Input
              type="number"
              min={-1}
              value={channels}
              onChange={(e) => setChannels(parseInt(e.target.value, 10) || 0)}
              required
              data-testid="input-plan-channels"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </label>

          <label>
            <strong>{S.adminPlanAnalysisUnits}</strong>
            <Input
              type="number"
              min={-1}
              value={analysisUnits}
              onChange={(e) =>
                setAnalysisUnits(parseInt(e.target.value, 10) || 0)
              }
              required
              data-testid="input-plan-analysis-units"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </label>

          <label>
            <strong>{S.adminPlanBackfillUnits}</strong>
            <Input
              type="number"
              min={-1}
              value={backfillUnits}
              onChange={(e) =>
                setBackfillUnits(parseInt(e.target.value, 10) || 0)
              }
              required
              data-testid="input-plan-backfill-units"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </label>

          <label>
            <strong>{S.adminPlanHistoricalDays}</strong>
            <Input
              type="number"
              min={0}
              value={historicalDays}
              onChange={(e) =>
                setHistoricalDays(parseInt(e.target.value, 10) || 0)
              }
              required
              data-testid="input-plan-historical-days"
            />
          </label>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              margin: "var(--space-2) 0",
            }}
          >
            <input
              type="checkbox"
              id="plan-allow-public"
              checked={allowPublic}
              onChange={(e) => setAllowPublic(e.target.checked)}
              data-testid="checkbox-plan-public"
            />
            <label
              htmlFor="plan-allow-public"
              style={{ cursor: "pointer", fontWeight: 500 }}
            >
              {S.adminPlanColPublicChannels}
            </label>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
              marginTop: "var(--space-2)",
            }}
          >
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              data-testid="btn-save-plan-limits"
            >
              {saving ? S.adminPlanSavingLimits : S.adminPlanSaveLimits}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
