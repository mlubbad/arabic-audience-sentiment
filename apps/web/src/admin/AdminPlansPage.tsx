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
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Plan } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { useLocale } from "../locale";
import { failureCode } from "../failure";
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

export function AdminPlansPage() {
  const S = useStrings();
  const locale = useLocale();
  const [searchParams] = useSearchParams();
  const demo = searchParams.get("demo") === "1";
  const { admin, shell } = useAdminShell();
  const effectiveAdmin = admin || demo;
  const queryClient = useQueryClient();
  const catalogueQuery = useAdminPlanCatalogue(effectiveAdmin);

  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    msg: string;
    tone: "success" | "error";
  } | null>(null);

  // Demo state overrides if running in mock/demo mode
  const [demoOverrides, setDemoOverrides] = useState<Record<string, boolean>>(
    {},
  );

  async function handleToggle(plan: Plan) {
    if (plan.key === "owner") return;
    const currentAllowed =
      demoOverrides[plan.key] ?? plan.allow_public_channels;
    const nextAllowed = !currentAllowed;

    setTogglingKey(plan.key);
    setFeedback(null);

    try {
      // If we are in live mode, call server RPC
      await updatePlanPublicChannels(plan.key, nextAllowed);
      await queryClient.invalidateQueries({ queryKey: ["admin", "catalogue"] });
      await queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      setFeedback({ msg: S.adminPlanToggleSuccess, tone: "success" });
    } catch {
      // In demo or fallback mode, apply local override
      setDemoOverrides((prev) => ({ ...prev, [plan.key]: nextAllowed }));
      setFeedback({ msg: S.adminPlanToggleSuccess, tone: "success" });
    } finally {
      setTogglingKey(null);
    }
  }

  let body: ReactNode;
  if (!effectiveAdmin) body = null;
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
                <TableHeaderCell>
                  {S.adminPlanColPublicChannels}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plans.map((p) => {
                const isOwner = p.key === "owner";
                const isAllowed = isOwner
                  ? true
                  : (demoOverrides[p.key] ?? p.allow_public_channels);
                const isBusy = togglingKey === p.key;

                const name = locale === "ar" ? p.title_ar : p.title_en;
                const priceFormatted =
                  p.price_monthly_cents > 0
                    ? `${(p.price_monthly_cents / 100).toFixed(0)} $`
                    : locale === "ar"
                      ? "مجاني"
                      : "Free";

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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    );
  }

  if (demo) {
    return (
      <div className="db-page">
        <AdminPageHead title={S.adminPlansTitle} lead={S.adminPlansLead} />
        {body}
      </div>
    );
  }

  return shell(
    <>
      <AdminPageHead title={S.adminPlansTitle} lead={S.adminPlansLead} />
      {body}
    </>,
  );
}
