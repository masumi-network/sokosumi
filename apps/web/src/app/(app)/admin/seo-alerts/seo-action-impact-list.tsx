import type { AdminSeoActionImpact } from "@sokosumi/core-client";
import Link from "next/link";
import type { getFormatter, getTranslations } from "next-intl/server";
import { seoActionImpactModel } from "@/app/seo/components/seo-action-impact-model";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

type Translate = Awaited<
  ReturnType<typeof getTranslations<"App.Admin.SeoAlerts">>
>;
type Format = Awaited<ReturnType<typeof getFormatter>>;
type Impact =
  AdminSeoActionImpact["items"][number]["actions"][number]["impact"];

const METRIC_LABEL = {
  clicks: "impactClicks",
  impressions: "impactImpressions",
  position: "impactPosition",
} as const;

function ImpactTable({
  impact,
  t,
  format,
}: {
  impact: Impact;
  t: Translate;
  format: Format;
}) {
  const figure = (
    value: number | null,
    side: "before" | "after",
    metric: keyof typeof METRIC_LABEL,
  ) =>
    value !== null
      ? format.number(
          value,
          metric === "position"
            ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
            : undefined,
        )
      : // A read window without impressions has no position. That is a result, not a missing read.
        t(impact[side] ? "impactNoPosition" : "impactNotMeasured");
  return (
    <table className="w-full text-start text-xs tabular-nums">
      <thead>
        <tr className="border-b">
          <th scope="col" className="sr-only">
            {t("impactMetric")}
          </th>
          <th scope="col" className="py-1 text-start font-medium">
            {t("impactBefore", { days: impact.days })}
          </th>
          <th scope="col" className="py-1 text-start font-medium">
            {t("impactAfter", { days: impact.days })}
          </th>
        </tr>
      </thead>
      <tbody>
        {seoActionImpactModel(impact).rows.map((row) => (
          <tr key={row.metric}>
            <th
              scope="row"
              className="text-muted-foreground py-1 pe-3 text-start font-normal"
            >
              {t(METRIC_LABEL[row.metric])}
            </th>
            <td className="py-1 pe-3">
              {figure(row.before, "before", row.metric)}
            </td>
            <td className="py-1">
              {figure(row.after, "after", row.metric)}
              {row.percent !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  (
                  {format.number(row.percent / 100, {
                    style: "percent",
                    signDisplay: "exceptZero",
                  })}
                  )
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Staff view: the before and after of done SEO actions, one entry per audit and the person whose data it holds. */
export function SeoActionImpactList({
  items,
  total,
  t,
  format,
}: {
  items: AdminSeoActionImpact["items"];
  total: number;
  t: Translate;
  format: Format;
}) {
  if (!items.length)
    return (
      <p className="text-muted-foreground">
        {t(total ? "emptyPage" : "impactEmpty")}
      </p>
    );
  return (
    <ul className={cn(HOLDER_CLASS, "space-y-2")}>
      {items.map((item) => (
        <li
          key={`${item.auditId ?? item.projectId}:${item.userId}`}
          className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-3")}
        >
          <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {t(item.auditId ? "auditId" : "projectId")}{" "}
              <code className="select-all break-all">
                {item.auditId ?? item.projectId}
              </code>
            </span>
            <span>
              {t("workspaceId")}{" "}
              <code className="select-all break-all">{item.workspaceId}</code>
            </span>
            <Link
              className="ms-auto underline"
              href={`/admin/users/${encodeURIComponent(item.userId)}`}
            >
              {t("openAccount")}
            </Link>
          </p>
          {item.actions.length ? (
            <ul className="space-y-3">
              {item.actions.map((action) => (
                <li key={action.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge
                      variant={
                        action.impact.state === "measured"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {t(`impactState.${action.impact.state}`)}
                    </Badge>
                    <span className="font-medium">{action.title}</span>
                  </div>
                  <p className="text-muted-foreground text-xs break-all">
                    {action.pageUrl}
                    {" · "}
                    {t(
                      action.impact.anchorKind === "verified"
                        ? "impactVerified"
                        : "impactCompleted",
                      {
                        date: format.dateTime(
                          new Date(`${action.impact.anchor}T12:00:00Z`),
                          { dateStyle: "medium" },
                        ),
                      },
                    )}
                  </p>
                  <ImpactTable impact={action.impact} t={t} format={format} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("impactNoActions")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
