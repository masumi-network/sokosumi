import type { AdminSeoAlerts } from "@sokosumi/core-client";
import type { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { costDetailView } from "./seo-audit-cost-detail-model";

type BillingRow = AdminSeoAlerts["billing"][number];
type Translate = Awaited<
  ReturnType<typeof getTranslations<"App.Admin.SeoAlerts">>
>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

const CELL = "py-1 pr-3";
const NUMBER_CELL = "py-1 pr-3 text-right tabular-nums";

function DetailTable({
  title,
  head,
  children,
}: {
  title: string;
  head: { label: string; numeric?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              {head.map(({ label, numeric }) => (
                <th
                  key={label}
                  className={cn(numeric ? NUMBER_CELL : CELL, "font-medium")}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Per model, DataForSEO endpoint and audit step cost of one settled full audit. */
export function SeoAuditCostDetail({
  detail,
  cost,
  dollars,
  t,
  format,
}: {
  detail: NonNullable<BillingRow["costDetail"]>;
  cost: NonNullable<BillingRow["cost"]>;
  dollars: (microUsd: number) => string;
  t: Translate;
  format: Format;
}) {
  const view = costDetailView(detail, cost);
  const unattributed = (
    <span className="text-muted-foreground">{t("unattributed")}</span>
  );
  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t("costDetail")}
      </summary>
      <div className="space-y-4 pt-2">
        <DetailTable
          title={t("costByModel")}
          head={[
            { label: t("detailModel") },
            { label: t("detailProvider") },
            { label: t("detailCalls"), numeric: true },
            { label: t("detailCost"), numeric: true },
          ]}
        >
          {view.models.map((row) => (
            <tr key={`${row.model}\n${row.provider ?? ""}`}>
              <td className={cn(CELL, "font-mono")}>{row.model}</td>
              <td className={CELL}>{row.provider ?? t("providerUnknown")}</td>
              <td className={NUMBER_CELL}>{format.number(row.calls)}</td>
              <td className={NUMBER_CELL}>
                {row.microUsd === null ? t("unpriced") : dollars(row.microUsd)}
              </td>
            </tr>
          ))}
          {view.modelGapMicroUsd !== 0 && (
            <tr>
              <td className={CELL} colSpan={3}>
                {unattributed}
              </td>
              <td className={NUMBER_CELL}>{dollars(view.modelGapMicroUsd)}</td>
            </tr>
          )}
        </DetailTable>
        <DetailTable
          title={t("costByDataForSeo")}
          head={[
            { label: t("detailEndpoint") },
            { label: t("detailReads"), numeric: true },
            { label: t("detailCost"), numeric: true },
          ]}
        >
          {view.dataForSeo.map((row) => (
            <tr key={row.endpoint}>
              <td className={cn(CELL, "font-mono")}>{row.endpoint}</td>
              <td className={NUMBER_CELL}>{format.number(row.reads)}</td>
              <td className={NUMBER_CELL}>{dollars(row.microUsd)}</td>
            </tr>
          ))}
          {view.dataForSeoGapMicroUsd !== 0 && (
            <tr>
              <td className={CELL} colSpan={2}>
                {unattributed}
              </td>
              <td className={NUMBER_CELL}>
                {dollars(view.dataForSeoGapMicroUsd)}
              </td>
            </tr>
          )}
        </DetailTable>
        <DetailTable
          title={t("costByStep")}
          head={[
            { label: t("detailStep") },
            { label: t("detailModelCost"), numeric: true },
            { label: t("detailDataForSeoCost"), numeric: true },
            { label: t("detailOtherApiCost"), numeric: true },
            { label: t("detailStepTotal"), numeric: true },
          ]}
        >
          {view.steps.map((row) => (
            <tr key={row.step ?? ""}>
              <td className={cn(CELL, "font-mono")}>
                {row.step ?? unattributed}
              </td>
              <td className={NUMBER_CELL}>{dollars(row.modelMicroUsd)}</td>
              <td className={NUMBER_CELL}>{dollars(row.dataForSeoMicroUsd)}</td>
              <td className={NUMBER_CELL}>{dollars(row.otherApiMicroUsd)}</td>
              <td className={NUMBER_CELL}>{dollars(row.totalMicroUsd)}</td>
            </tr>
          ))}
        </DetailTable>
      </div>
    </details>
  );
}
