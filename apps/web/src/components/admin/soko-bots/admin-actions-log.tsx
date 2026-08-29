import { getFormatter, getTranslations } from "next-intl/server";

import { Panel } from "@/components/soko-bot/panel";
import {
  formatRedactedValue,
  redactProposalValue,
} from "@/components/soko-bot/proposal-summary";
import {
  StatusBadge,
  type StatusTone,
} from "@/components/soko-bot/status-badge";
import type { SokoBotAdminAction } from "@/lib/clients/generated/core";

import { type AuditOutcome, groupAuditOperations } from "./audit-operations";

interface AdminActionsLogProps {
  actions: SokoBotAdminAction[];
}

const OUTCOME_TONE: Record<AuditOutcome, StatusTone> = {
  SUCCEEDED: "success",
  FAILED: "danger",
  ATTEMPTED: "warning",
};

function preview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return formatRedactedValue(redactProposalValue(value));
}

/**
 * Immutable operator audit trail, one row per operation. Outcome is derived
 * from the paired outbox rows; a lone ATTEMPTED is flagged as unconfirmed so
 * crashed/orphaned operations are never mistaken for successes.
 */
export async function AdminActionsLog({ actions }: AdminActionsLogProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Audit"),
    getFormatter(),
  ]);
  const operations = groupAuditOperations(actions);
  const dateTime = (date: Date | null) =>
    date
      ? format.dateTime(date, { dateStyle: "medium", timeStyle: "medium" })
      : null;

  return (
    <Panel
      id="audit"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: operations.length })}
        </span>
      }
      flush
    >
      {operations.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <ol className="divide-y">
          {operations.map((operation) => {
            const before = preview(operation.before);
            const after = preview(operation.after);
            return (
              <li
                key={operation.operationId}
                className="space-y-1.5 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-medium">
                    {operation.action}
                  </span>
                  <StatusBadge
                    tone={OUTCOME_TONE[operation.outcome]}
                    live={operation.outcome === "ATTEMPTED"}
                  >
                    {t(`outcome.${operation.outcome}`)}
                  </StatusBadge>
                  {operation.targetId ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {t("target")} {operation.targetId}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("attemptedAt")} {dateTime(operation.attemptedAt) ?? "—"}
                  </span>
                  {operation.resolvedAt ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("resolvedAt")} {dateTime(operation.resolvedAt)}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground font-mono text-xs">
                    {t("operator")} {operation.operatorId}
                  </span>
                </div>
                <p>{operation.reason}</p>
                {operation.outcome === "ATTEMPTED" ? (
                  <p role="status" className="text-semantic-warning text-xs">
                    {t("orphanHint")}
                  </p>
                ) : null}
                {operation.outcome === "FAILED" ? (
                  <p className="text-semantic-destructive text-xs">
                    {t("failedLabel")}{" "}
                    <span className="font-mono">
                      {operation.errorKind ?? t("unknownError")}
                    </span>
                    {operation.errorDetail ? `: ${operation.errorDetail}` : ""}
                  </p>
                ) : null}
                {before || after ? (
                  <p className="text-muted-foreground font-mono text-xs break-words">
                    {before ? `${t("before")} ${before}` : ""}
                    {before && after ? " → " : ""}
                    {after ? `${t("after")} ${after}` : ""}
                  </p>
                ) : null}
                <p className="text-muted-foreground font-mono text-xs break-all">
                  {t("operation")} {operation.operationId}
                  {operation.requestId
                    ? ` · ${t("request")} ${operation.requestId}`
                    : ""}
                  {operation.traceId
                    ? ` · ${t("trace")} ${operation.traceId}`
                    : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
