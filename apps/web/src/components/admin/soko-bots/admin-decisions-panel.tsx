import { getFormatter, getTranslations } from "next-intl/server";

import { Panel } from "@/components/soko-bot/panel";
import { DecisionStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import type { SokoBotPendingDecision } from "@/lib/clients/generated/core";

interface AdminDecisionsPanelProps {
  decisions: SokoBotPendingDecision[];
}

export async function AdminDecisionsPanel({
  decisions,
}: AdminDecisionsPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Decisions"),
    getFormatter(),
  ]);
  const dateTime = (date: Date | null) =>
    date
      ? format.dateTime(date, { dateStyle: "short", timeStyle: "short" })
      : "—";

  return (
    <Panel
      id="decisions"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: decisions.length })}
        </span>
      }
      flush
    >
      {decisions.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">{t("tool")}</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
                <th className="px-4 py-2 font-medium">{t("reason")}</th>
                <th className="px-4 py-2 font-medium">{t("turn")}</th>
                <th className="px-4 py-2 font-medium">{t("created")}</th>
                <th className="px-4 py-2 font-medium">{t("expires")}</th>
                <th className="px-4 py-2 font-medium">{t("resolved")}</th>
                <th className="px-4 py-2 font-medium">{t("result")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {decisions.map((decision) => (
                <tr key={decision.id} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs">
                    {decision.toolName}
                  </td>
                  <td className="px-4 py-2">
                    <DecisionStatusBadge status={decision.status} />
                  </td>
                  <td className="max-w-md px-4 py-2">{decision.reason}</td>
                  <td className="text-muted-foreground px-4 py-2 font-mono text-xs">
                    {decision.turnId.slice(0, 8)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs tabular-nums">
                    {dateTime(decision.createdAt)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs tabular-nums">
                    {dateTime(decision.expiresAt)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs tabular-nums">
                    {dateTime(decision.resolvedAt)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 font-mono text-xs">
                    {decision.resultingEntityId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
