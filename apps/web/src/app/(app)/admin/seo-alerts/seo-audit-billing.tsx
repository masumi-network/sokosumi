import type { AdminSeoAlerts } from "@sokosumi/core-client";
import Link from "next/link";
import type { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoAuditCostDetail } from "./seo-audit-cost-detail";

const categories = [
  "gatewayMicroUsd",
  "directModelMicroUsd",
  "dataForSeoMicroUsd",
  "otherApiMicroUsd",
] as const;
const MICRO_USD_PER_USD = 1_000_000;
type Translate = Awaited<
  ReturnType<typeof getTranslations<"App.Admin.SeoAlerts">>
>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

export function SeoAuditBilling({
  rows,
  total,
  t,
  format,
}: {
  rows: AdminSeoAlerts["billing"];
  total: number;
  t: Translate;
  format: Format;
}) {
  const dollars = (microUsd: number) =>
    format.number(microUsd / MICRO_USD_PER_USD, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  return (
    <>
      <p className="text-muted-foreground text-sm">{t("billingDescription")}</p>
      {rows.length ? (
        <ul className={cn(HOLDER_CLASS, "space-y-2")}>
          {rows.map((row) => (
            <li key={row.id} className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-3")}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={row.status === "settled" ? "secondary" : "outline"}
                >
                  {t(row.status)}
                </Badge>
                <time
                  className="text-muted-foreground text-sm"
                  dateTime={row.at.toISOString()}
                >
                  {format.dateTime(row.at, "dateTimeMedium")}
                </time>
                {row.taskId && (
                  <Link
                    className="ms-auto break-all text-sm underline"
                    href={`/admin/tasks/${encodeURIComponent(row.taskId)}`}
                  >
                    {t("taskId")} <code>{row.taskId}</code>
                  </Link>
                )}
              </div>
              <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {(
                  [
                    ["runId", row.id],
                    ["auditId", row.auditId],
                    ["projectId", row.projectId],
                    ["workspaceId", row.workspaceId],
                  ] as const
                ).map(
                  ([label, value]) =>
                    value && (
                      <span key={label}>
                        {t(label)}{" "}
                        <code className="select-all break-all">{value}</code>
                      </span>
                    ),
                )}
              </p>
              <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums">
                {row.attemptedCredits != null &&
                  row.attemptedCredits !== row.chargedCredits && (
                    <div>
                      <dt className="text-muted-foreground">
                        {t("attemptedCharge")}
                      </dt>
                      <dd>{t("credits", { credits: row.attemptedCredits })}</dd>
                    </div>
                  )}
                {(row.chargedCredits != null ||
                  row.attemptedCredits != null) && (
                  <div>
                    <dt className="text-muted-foreground">{t("charged")}</dt>
                    <dd>
                      {t("credits", { credits: row.chargedCredits ?? 0 })}
                    </dd>
                  </div>
                )}
                {row.approvedMaxCredits != null && (
                  <div>
                    <dt className="text-muted-foreground">
                      {t("approvalCap")}
                    </dt>
                    <dd>{t("credits", { credits: row.approvedMaxCredits })}</dd>
                  </div>
                )}
                {row.dataBudgetUsd != null && (
                  <div>
                    <dt className="text-muted-foreground">{t("dataBudget")}</dt>
                    <dd>
                      {format.number(row.dataBudgetUsd, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 6,
                      })}
                    </dd>
                  </div>
                )}
                {row.cost && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">
                        {t("costTotal")}
                      </dt>
                      <dd>
                        {dollars(
                          categories.reduce(
                            (sum, key) => sum + row.cost![key],
                            0,
                          ),
                        )}
                      </dd>
                    </div>
                    {categories.map((key) => (
                      <div key={key}>
                        <dt className="text-muted-foreground">{t(key)}</dt>
                        <dd>{dollars(row.cost![key])}</dd>
                      </div>
                    ))}
                  </>
                )}
              </dl>
              {row.cost && row.costDetail && (
                <SeoAuditCostDetail
                  detail={row.costDetail}
                  cost={row.cost}
                  dollars={dollars}
                  t={t}
                  format={format}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {t(total ? "emptyPage" : "billingEmpty")}
        </p>
      )}
    </>
  );
}
