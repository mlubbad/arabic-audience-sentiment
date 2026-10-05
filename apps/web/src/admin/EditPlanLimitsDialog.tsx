/**
 * Dialog for platform administrators to dynamically adjust subscription plan limits.
 *
 * Allows updating channels, analysis units, historical backfill quota, historical depth,
 * topic units, members limit, and public channels access without needing migrations.
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

/** A whole number of at least -1 (-1 means unlimited), or null for a blank
 *  or malformed field. */
export function parseLimit(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= -1 ? n : null;
}

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

  const [channels, setChannels] = useState<string>(
    String(plan?.limits.channels ?? 1),
  );
  const [analysisUnits, setAnalysisUnits] = useState<string>(
    String(plan?.limits.analysis_units ?? 10000),
  );
  const [backfillUnits, setBackfillUnits] = useState<string>(
    String(plan?.backfill_units ?? 40000),
  );
  const [historicalDays, setHistoricalDays] = useState<string>(
    String(plan?.historical_days_limit ?? -1),
  );
  const [topicUnits, setTopicUnits] = useState<string>(
    String(plan?.limits.topic_units ?? 4000),
  );
  const [members, setMembers] = useState<string>(
    String(plan?.limits.members ?? 1),
  );
  const [workspaces, setWorkspaces] = useState<string>(
    String(plan?.limits.workspaces ?? 1),
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

    // A blank or malformed field is an error, never 0: a limit of 0 would
    // silently lock every workspace on this plan out of the feature.
    const values = {
      channels: parseLimit(channels),
      analysisUnits: parseLimit(analysisUnits),
      backfillUnits: parseLimit(backfillUnits),
      historicalDays: parseLimit(historicalDays),
      topicUnits: parseLimit(topicUnits),
      members: parseLimit(members),
      workspaces: parseLimit(workspaces),
    };
    if (Object.values(values).some((v) => v === null)) {
      setErrorMsg(S.adminPlanLimitsInvalid);
      return;
    }
    const v = values as { [K in keyof typeof values]: number };

    setSaving(true);
    setErrorMsg(null);

    try {
      await updatePlanLimits(plan.key, {
        channels: v.channels,
        channels_limit: v.channels,
        analysis_units: v.analysisUnits,
        backfill_units: v.backfillUnits,
        historical_days_limit: v.historicalDays,
        topic_units: v.topicUnits,
        members: v.members,
        members_limit: v.members,
        workspaces: v.workspaces,
        workspaces_limit: v.workspaces,
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
          {/* Channels Limit */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanChannelsLimit}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={channels === "-1"}
                  onChange={(e) => setChannels(e.target.checked ? "-1" : "1")}
                  data-testid="checkbox-unlimited-channels"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={channels}
              onChange={(e) => setChannels(e.target.value)}
              required
              data-testid="input-plan-channels"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Analysis Units */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanAnalysisUnits}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={analysisUnits === "-1"}
                  onChange={(e) =>
                    setAnalysisUnits(e.target.checked ? "-1" : "10000")
                  }
                  data-testid="checkbox-unlimited-analysis"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={analysisUnits}
              onChange={(e) => setAnalysisUnits(e.target.value)}
              required
              data-testid="input-plan-analysis-units"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Backfill Units */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanBackfillUnits}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={backfillUnits === "-1"}
                  onChange={(e) =>
                    setBackfillUnits(e.target.checked ? "-1" : "40000")
                  }
                  data-testid="checkbox-unlimited-backfill"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={backfillUnits}
              onChange={(e) => setBackfillUnits(e.target.value)}
              required
              data-testid="input-plan-backfill-units"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Historical Depth (Days) */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanHistoricalDays}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={historicalDays === "-1"}
                  onChange={(e) =>
                    setHistoricalDays(e.target.checked ? "-1" : "30")
                  }
                  data-testid="checkbox-unlimited-historical-days"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={historicalDays}
              onChange={(e) => setHistoricalDays(e.target.value)}
              required
              data-testid="input-plan-historical-days"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Topic Classification Units */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanTopicUnits}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={topicUnits === "-1"}
                  onChange={(e) =>
                    setTopicUnits(e.target.checked ? "-1" : "4000")
                  }
                  data-testid="checkbox-unlimited-topic-units"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={topicUnits}
              onChange={(e) => setTopicUnits(e.target.value)}
              required
              data-testid="input-plan-topic-units"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Members Limit */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanMembersLimit}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={members === "-1"}
                  onChange={(e) => setMembers(e.target.checked ? "-1" : "1")}
                  data-testid="checkbox-unlimited-members"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              required
              data-testid="input-plan-members"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Workspaces Limit */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <strong>{S.adminPlanWorkspacesLimit}</strong>
              <label
                style={{
                  fontSize: "0.82rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={workspaces === "-1"}
                  onChange={(e) => setWorkspaces(e.target.checked ? "-1" : "1")}
                  data-testid="checkbox-unlimited-workspaces"
                />
                <span>{S.adminPlanUnlimitedCheckbox}</span>
              </label>
            </div>
            <Input
              type="number"
              min={-1}
              value={workspaces}
              onChange={(e) => setWorkspaces(e.target.value)}
              required
              data-testid="input-plan-workspaces"
            />
            <small className="db-muted">{S.adminPlanUnlimitedHelp}</small>
          </div>

          {/* Allow Public Channels Checkbox */}
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
