import { getFormatter, getTranslations } from "next-intl/server";

import {
  AutonomyBadge,
  SokoBotStatusBadge,
} from "@/components/soko-bot/soko-bot-badges";
import type { SokoBot } from "@/lib/clients/generated/core";

interface SokoBotHeaderProps {
  bot: SokoBot;
}

export async function SokoBotHeader({ bot }: SokoBotHeaderProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.SokoBot.Header"),
    getFormatter(),
  ]);

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {bot.name ?? t("defaultName")}
          </h1>
          <SokoBotStatusBadge status={bot.status} />
          <AutonomyBadge level={bot.autonomyLevel} />
        </div>
        <p className="text-muted-foreground text-sm">{t("tagline")}</p>
      </div>
      <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex gap-1">
          <dt>{t("lastActivity")}</dt>
          <dd className="text-foreground tabular-nums">
            {bot.lastActivityAt
              ? format.dateTime(bot.lastActivityAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "—"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>{t("failures")}</dt>
          <dd className="text-foreground tabular-nums">
            {bot.consecutiveTurnFailures}
          </dd>
        </div>
      </dl>
    </header>
  );
}
