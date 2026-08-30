import { convertCentsToCredits } from "@sokosumi/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { shortId } from "@/components/soko-bot/format";

import { MetaGrid } from "@/components/soko-bot/meta-grid";
import { Panel } from "@/components/soko-bot/panel";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import type { AdminSokoBotDetail } from "@/lib/clients/generated/core";

interface AdminSokoBotOverviewProps {
  bot: AdminSokoBotDetail;
}

export async function AdminSokoBotOverview({ bot }: AdminSokoBotOverviewProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Overview"),
    getFormatter(),
  ]);
  // The request's locale, like every other number on this page.
  const numbers = (value: number) => format.number(value);
  const dateTime = (date: Date | null | undefined) =>
    date
      ? format.dateTime(date, { dateStyle: "medium", timeStyle: "short" })
      : null;

  const health = bot.runtimeHealth;
  const completed = bot.turns.filter((turn) => turn.status === "COMPLETED");
  const failed = bot.turns.filter((turn) => turn.status === "FAILED");
  const successRate =
    bot.turns.length > 0
      ? `${Math.round((completed.length / bot.turns.length) * 100)}%`
      : null;

  return (
    <Panel id="overview" title={t("title")}>
      <div className="space-y-6">
        <MetaGrid
          columns={4}
          items={[
            { label: t("owner"), value: bot.owner.email },
            { label: t("workspaceUser"), value: bot.userId, mono: true },
            { label: t("createdAt"), value: dateTime(bot.createdAt) },
            { label: t("updatedAt"), value: dateTime(bot.updatedAt) },
            { label: t("archivedAt"), value: dateTime(bot.archivedAt) },
            { label: t("lastActivityAt"), value: dateTime(bot.lastActivityAt) },
            { label: t("lastTurnAt"), value: dateTime(bot.lastTurnAt) },
            {
              label: t("lastSucceededAt"),
              value: dateTime(bot.lastSucceededAt),
            },
            { label: t("lastFailedAt"), value: dateTime(bot.lastFailedAt) },
            {
              label: t("consecutiveFailures"),
              value: bot.consecutiveTurnFailures,
            },
            {
              label: t("recentTurns"),
              value: t("recentTurnsValue", {
                total: bot.turns.length,
                completed: completed.length,
                failed: failed.length,
              }),
            },
            { label: t("successRate"), value: successRate },
          ]}
        />
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t("runtime")}
            </h3>
            {health ? (
              <StatusBadge
                tone={health.healthy ? "success" : "danger"}
                live={health.healthy}
              >
                {health.healthy ? t("healthy") : t("unhealthy")}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{t("healthUnknown")}</StatusBadge>
            )}
            {health?.errorKind ? (
              <span className="text-semantic-destructive font-mono text-xs">
                {health.errorKind}
              </span>
            ) : null}
            {health ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("checkedAt")} {dateTime(health.checkedAt)}
              </span>
            ) : null}
          </div>
          <MetaGrid
            columns={4}
            items={[
              {
                label: t("healthRuntimeVersion"),
                value: health?.runtimeVersion,
                mono: true,
              },
              { label: t("sessionStatus"), value: health?.sessionStatus },
              { label: t("eveSessionId"), value: bot.eveSessionId, mono: true },
              {
                label: t("runtimeVersion"),
                value: bot.runtimeVersion,
                mono: true,
              },
              {
                label: t("runtimeDeployment"),
                value: bot.runtimeDeployment,
                mono: true,
              },
              { label: t("sandboxId"), value: bot.lastSandboxId, mono: true },
              { label: t("sandboxStatus"), value: bot.lastSandboxStatus },
              { label: t("memoryVersion"), value: bot.memoryVersion },
              {
                label: t("memoryHash"),
                value: shortId(bot.memoryHash),
                mono: true,
              },
              {
                label: t("personality"),
                value:
                  bot.personalityTone !== null ||
                  bot.personalityDetail !== null ||
                  bot.personalityStyle !== null
                    ? `${bot.personalityTone ?? "–"} / ${bot.personalityDetail ?? "–"} / ${bot.personalityStyle ?? "–"}`
                    : null,
              },
              // Everything the bot has spent. Credits are what the owner was
              // charged; the model cost is what the tokens actually cost,
              // including the classifier and judge calls that are not billed.
              {
                label: t("usageCredits"),
                value: numbers(
                  convertCentsToCredits(BigInt(bot.usage.creditsCents)),
                ),
              },
              {
                label: t("usageTurns"),
                value: numbers(bot.usage.turns),
              },
              {
                label: t("usageTokens"),
                value: `${numbers(bot.usage.totalTokens)} (${numbers(bot.usage.inputTokens)} / ${numbers(bot.usage.outputTokens)})`,
              },
              {
                label: t("usageModelCost"),
                value: format.number(bot.usage.costUsd, {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 4,
                }),
                mono: true,
              },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}
