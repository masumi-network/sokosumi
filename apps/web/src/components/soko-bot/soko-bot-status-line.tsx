"use client";

import { SokoBotStatus } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, Suspense, use } from "react";
import { browser } from "react-dom";
import {
  useFormatShortTimeAgo,
  useSharedNow,
} from "@/components/short-time-ago";
import { SOKO_BOT_STATUS_TONE } from "@/components/soko-bot/soko-bot-badges";
import { statusToneTextClass } from "@/components/soko-bot/status-badge";
import type { LiveSokoBotFields } from "@/hooks/effects/use-live-soko-bot-poll";
import { cn } from "@/lib/utils";

/**
 * What your Soko Bot is doing, in the tone the Soko Bot status badge paints
 * it. The words are the sidebar's where a row says more than the badge's one
 * word ("Working now", when an idle bot was last active), and the badge's
 * own where they agree ("Paused", "Couldn't reply"). The sidebar's bot row
 * and the chat list's Direct with that bot both draw this, so the bot has one
 * status wherever it appears.
 */
export function SokoBotStatusLine({
  bot,
  className,
}: {
  bot: LiveSokoBotFields;
  className?: string;
}) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const tStatus = useTranslations("Components.SokoBot.BotStatus");
  const text: Record<SokoBotStatus, ReactNode> = {
    [SokoBotStatus.RUNNING]: t("workingNow"),
    [SokoBotStatus.PAUSED]: tStatus(SokoBotStatus.PAUSED),
    [SokoBotStatus.ERROR]: tStatus(SokoBotStatus.ERROR),
    [SokoBotStatus.IDLE]: bot.lastActivityAt ? (
      <LastActive at={bot.lastActivityAt} />
    ) : (
      t("ready")
    ),
  };

  return (
    <span
      data-slot="soko-bot-status-line"
      className={cn(
        "truncate text-xs leading-tight",
        statusToneTextClass(SOKO_BOT_STATUS_TONE[bot.status]),
        className,
      )}
    >
      {text[bot.status]}
    </span>
  );
}

/**
 * "Active 2h ago", in the short form Home's rows use and on their clock. The
 * server sends the time of day instead ("Active 9:34 PM"): its clock and the
 * browser's differ by the load, so a relative label from each would not
 * hydrate (React #418), and a date as well would not fit the row.
 */
export function LastActive({ at }: { at: Date }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const formatter = useFormatter();

  return (
    <Suspense
      fallback={t("activeAgo", { time: formatter.dateTime(at, "time") })}
    >
      <LastActiveRelative at={at} />
    </Suspense>
  );
}

function LastActiveRelative({ at }: { at: Date }) {
  use(browser());
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const formatShortTimeAgo = useFormatShortTimeAgo();

  return t("activeAgo", { time: formatShortTimeAgo(at, useSharedNow()) });
}
