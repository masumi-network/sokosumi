import type { AdminSokoBotDetail } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { shortId } from "@/components/soko-bot/format";
import { MetaGrid } from "@/components/soko-bot/meta-grid";
import { Panel } from "@/components/soko-bot/panel";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface AdminSokoBotOverviewProps {
  bot: AdminSokoBotDetail;
}

/**
 * What an operator checks first: is it working, how much does it run and cost,
 * and which version is it on. Runtime internals and ids stay one click away.
 */
export async function AdminSokoBotOverview({ bot }: AdminSokoBotOverviewProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Overview"),
    getFormatter(),
  ]);
  // The request's locale, like every other number on this page.
  const numbers = (value: number) => format.number(value);
  const dateTime = (date: Date | null | undefined) =>
    date ? format.dateTime(date, "dateTimeMedium") : null;

  const health = bot.runtimeHealth;
  const completed = bot.turns.filter((turn) => turn.status === "COMPLETED");
  const failed = bot.turns.filter((turn) => turn.status === "FAILED");
  const successRate =
    bot.turns.length > 0
      ? `${Math.round((completed.length / bot.turns.length) * 100)}%`
      : null;

  const money = format.number(bot.usage.costUsd, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  const keyStats = [
    {
      key: "lastActivityAt",
      value: bot.lastActivityAt
        ? format.relativeTime(bot.lastActivityAt)
        : null,
    },
    {
      key: "successRate",
      value: successRate,
      hint: t("recentTurnsValue", {
        total: bot.turns.length,
        completed: completed.length,
        failed: failed.length,
      }),
      // Red only while it is failing now; one old failure is not news.
      alert: bot.consecutiveTurnFailures > 0,
    },
    { key: "usageTurns", value: numbers(bot.usage.turns) },
    { key: "usageCredits", value: numbers(Math.round(bot.usage.credits)) },
    { key: "usageModelCost", value: money },
    {
      key: "version",
      value: bot.versionId ? (
        <Link
          href={`${ADMIN_SOKO_BOTS_ROUTE}/${bot.id}/advanced#version`}
          className="underline-offset-4 hover:underline"
        >
          {bot.versionId}
        </Link>
      ) : null,
    },
  ] as const;

  return (
    <Panel id="overview" title={t("title")}>
      <div className="space-y-4">
        {health && !health.healthy ? (
          <p className="text-semantic-destructive text-sm">
            {t("unhealthy")}
            {health.errorKind ? ` · ${health.errorKind}` : ""}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          {keyStats.map((stat) => (
            <div key={stat.key} className="min-w-0 space-y-0.5">
              <dt className="text-muted-foreground text-xs">{t(stat.key)}</dt>
              <dd
                className={cn(
                  "truncate text-lg font-semibold tabular-nums tracking-tight",
                  "alert" in stat && stat.alert && "text-semantic-destructive",
                )}
                title={"hint" in stat ? stat.hint : undefined}
              >
                {stat.value ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          ))}
        </dl>

        <details className="group border-t pt-3">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-3.5 transition-transform group-open:rotate-90"
            />
            {t("technicalDetails")}
          </summary>
          <div className="space-y-6 pt-4">
            <MetaGrid
              columns={4}
              items={[
                { label: t("botId"), value: bot.id, mono: true },
                { label: t("owner"), value: bot.owner.email },
                { label: t("workspaceUser"), value: bot.userId, mono: true },
                { label: t("createdAt"), value: dateTime(bot.createdAt) },
                { label: t("updatedAt"), value: dateTime(bot.updatedAt) },
                { label: t("archivedAt"), value: dateTime(bot.archivedAt) },
                {
                  label: t("lastActivityAt"),
                  value: dateTime(bot.lastActivityAt),
                },
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
                  {
                    label: t("eveSessionId"),
                    value: bot.eveSessionId,
                    mono: true,
                  },
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
                  {
                    label: t("sandboxId"),
                    value: bot.lastSandboxId,
                    mono: true,
                  },
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
        </details>
      </div>
    </Panel>
  );
}
