/**
 * Account types & plan permissions management page.
 *
 * Platform operators use this to review all account tiers (plans) and manage
 * feature permissions — specifically gating the "لا أملك القناة" (Public channel
 * search & tracking) capability.
 *
 * By default, only the 'owner' plan has this permission enabled. The operator
 * can toggle access for other account types (e.g. Creator Plus, Agency, Media, Enterprise)
 * right here.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Plan } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { useLocale } from "../locale";
import { failureCode } from "../failure";
import { adminWriteFailure } from "../adminWords";
import { ChartEmpty, LoadError, Loading } from "../pageStates/PageStates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { useAdminPlanCatalogue } from "../planCatalogue";
import { updatePlanPublicChannels } from "./adminRead";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { EditPlanLimitsDialog } from "./EditPlanLimitsDialog";

export function AdminPlansPage() {
  const S = useStrings();
  const locale = useLocale();
  // Live data only: in the demo the shell says so and nothing is read or
  // written (owner console review, 2026-10-13, finding 15).
  const { admin, shell } = useAdminShell();
  const queryClient = useQueryClient();
  const catalogueQuery = useAdminPlanCatalogue(admin);

  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [feedback, setFeedback] = useState<{
    msg: string;
    tone: "success" | "error";
  } | null>(null);

  async function handleToggle(plan: Plan) {
    if (plan.key === "owner") return;
    const nextAllowed = !plan.allow_public_channels;

    setTogglingKey(plan.key);
    setFeedback(null);

    try {
      await updatePlanPublicChannels(plan.key, nextAllowed);
      await queryClient.invalidateQueries({ queryKey: ["admin", "catalogue"] });
      await queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      setFeedback({ msg: S.adminPlanToggleSuccess, tone: "success" });
    } catch (error) {
      // The save did not happen: say so, and leave the toggle where the
      // database has it (it used to report success and flip it anyway).
      setFeedback({
        msg: adminWriteFailure(S.adminPlanToggleFailed, error),
        tone: "error",
      });
    } finally {
      setTogglingKey(null);
    }
  }

  let body: ReactNode;
  if (!admin) body = null;
  else if (catalogueQuery.isPending)
    body = <Loading S={S} label={S.adminPlansLoading} shape="ops" />;
  else if (catalogueQuery.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", catalogueQuery.error)}
        onRetry={() => void catalogueQuery.refetch()}
      />
    );
  else if (!catalogueQuery.data || catalogueQuery.data.length === 0)
    body = (
      <ChartEmpty testId="admin-plans-empty">{S.adminPlansEmpty}</ChartEmpty>
    );
  else {
    const plans = catalogueQuery.data;

    body = (
      <section className="db-section" aria-labelledby="admin-plans-heading">
        <header>
          <h2 id="admin-plans-heading">{S.adminPlansHeading}</h2>
        </header>

        {feedback && (
          <div
            role="status"
            className="db-channel-feedback"
            style={{
              marginBottom: "var(--space-3)",
              color:
                feedback.tone === "success"
                  ? "var(--tone-success)"
                  : "var(--tone-danger)",
            }}
          >
            {feedback.msg}
          </div>
        )}

        <div className="table-wrap db-admin-wrap">
          <Table data-testid="admin-plans-table">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{S.adminPlanColName}</TableHeaderCell>
                <TableHeaderCell>{S.adminPlanColKey}</TableHeaderCell>
                <TableHeaderCell>{S.adminPlanColSegment}</TableHeaderCell>
                <TableHeaderCell>{S.adminPlanColPrice}</TableHeaderCell>
                <TableHeaderCell>{S.adminPlanColLimits}</TableHeaderCell>
                <TableHeaderCell>
                  {S.adminPlanColPublicChannels}
                </TableHeaderCell>
                <TableHeaderCell>{S.adminPlanEditLimits}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plans.map((p) => {
                const isOwner = p.key === "owner";
                const isAllowed = isOwner ? true : p.allow_public_channels;
                const isBusy = togglingKey === p.key;

                const name = locale === "ar" ? p.title_ar : p.title_en;
                const priceFormatted =
                  p.price_monthly_cents > 0
                    ? `${(p.price_monthly_cents / 100).toFixed(0)} $`
                    : locale === "ar"
                      ? "مجاني"
                      : "Free";

                const backfillVal =
                  p.backfill_units == null || p.backfill_units === -1
                    ? -1
                    : p.backfill_units;
                const daysVal =
                  p.historical_days_limit == null ||
                  p.historical_days_limit === -1
                    ? -1
                    : p.historical_days_limit;

                return (
                  <TableRow key={p.key} data-testid={`plan-row-${p.key}`}>
                    <TableCell>
                      <strong>{name}</strong>
                    </TableCell>
                    <TableCell>
                      <code>{p.key}</code>
                    </TableCell>
                    <TableCell>
                      <Badge tone="neutral">
                        {p.segment === "internal"
                          ? locale === "ar"
                            ? "داخلي"
                            : "Internal"
                          : p.segment === "business"
                            ? locale === "ar"
                              ? "أعمال"
                              : "Business"
                            : locale === "ar"
                              ? "أفراد"
                              : "Individual"}
                      </Badge>
                    </TableCell>
                    <TableCell>{priceFormatted}</TableCell>
                    <TableCell>
                      <div style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>
                        <div>
                          {locale === "ar" ? "قنوات: " : "Channels: "}
                          <strong>
                            {p.limits.channels === -1
                              ? S.pricingUnlimited
                              : p.limits.channels}
                          </strong>
                        </div>
                        <div>
                          {locale === "ar" ? "تحليل شهري: " : "Analysis: "}
                          <strong>
                            {p.limits.analysis_units === -1
                              ? S.pricingUnlimited
                              : p.limits.analysis_units.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          {locale === "ar" ? "جلب تاريخي: " : "Backfill: "}
                          <strong>
                            {backfillVal === -1
                              ? S.pricingUnlimited
                              : backfillVal.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          {locale === "ar" ? "أيام سابقة: " : "History: "}
                          <strong>
                            {daysVal === -1
                              ? S.pricingUnlimited
                              : `${daysVal}d`}
                          </strong>
                        </div>
                        <div>
                          {locale === "ar" ? "تصنيف مواضيع: " : "Topics: "}
                          <strong>
                            {p.limits.topic_units === -1
                              ? S.pricingUnlimited
                              : p.limits.topic_units.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          {locale === "ar" ? "أعضاء: " : "Members: "}
                          <strong>
                            {p.limits.members === -1
                              ? S.pricingUnlimited
                              : p.limits.members}
                          </strong>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Badge
                          tone="success"
                          data-testid={`badge-owner-${p.key}`}
                        >
                          {S.adminPlanOwnerAlwaysActive}
                        </Badge>
                      ) : (
                        <div className="db-admin-plan-toggle">
                          <Button
                            variant={isAllowed ? "primary" : "secondary"}
                            disabled={isBusy}
                            onClick={() => void handleToggle(p)}
                            aria-label={`${S.adminPlanColPublicChannels}: ${name}`}
                            data-testid={`toggle-plan-${p.key}`}
                          >
                            {isBusy
                              ? "…"
                              : isAllowed
                                ? `✓ ${S.adminPlanPublicChannelsAllowed}`
                                : `✕ ${S.adminPlanPublicChannelsBlocked}`}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="secondary"
                        onClick={() => setEditingPlan(p)}
                        data-testid={`btn-edit-limits-${p.key}`}
                      >
                        {S.adminPlanEditLimits}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {editingPlan && (
          <EditPlanLimitsDialog
            plan={editingPlan}
            open={Boolean(editingPlan)}
            onClose={() => setEditingPlan(null)}
            onSuccess={() => {
              void queryClient.invalidateQueries({
                queryKey: ["admin", "catalogue"],
              });
              void queryClient.invalidateQueries({ queryKey: ["catalogue"] });
              setFeedback({ msg: S.adminPlanLimitsUpdated, tone: "success" });
            }}
          />
        )}
      </section>
    );
  }

  return shell(
    <>
      <AdminPageHead title={S.adminPlansTitle} lead={S.adminPlansLead} />
      {body}
    </>,
  );
}
