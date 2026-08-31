import {
  SOKO_BOT_PROACTIVE_RULES,
  SOKO_BOT_SYSTEM_SCHEDULES,
} from "@sokosumi/soko-bot";
import { useTranslations } from "next-intl";

import type { ChatSchedule } from "@/lib/soko-bot/chat-state";
import { describeCron } from "@/lib/soko-bot/describe-cron";

/**
 * What the assistant does on its own: its rhythms (with the live schedule
 * state) and every trigger that can make it act. Text is single-sourced
 * from @sokosumi/soko-bot so the page and the behaviour cannot drift.
 */
export function HowItWorks({ schedules }: { schedules: ChatSchedule[] }) {
  const t = useTranslations("App.SokoBot.HowItWorks");
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {t("rhythms")}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SOKO_BOT_SYSTEM_SCHEDULES.map((rhythm) => {
            const live = schedules.find((s) => s.systemKey === rhythm.key);
            return (
              <li
                key={rhythm.key}
                className="bg-muted/40 flex flex-col gap-1 rounded-lg px-3 py-2.5 text-sm"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{rhythm.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {live && !live.enabled
                      ? t("paused")
                      : describeCron(
                          live?.cronExpression ?? rhythm.cronExpression,
                        )}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {rhythm.description}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {t("triggers")}
        </p>
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {SOKO_BOT_PROACTIVE_RULES.map((rule) => (
            <li key={rule.id} className="text-sm">
              <p className="font-medium">{rule.title}</p>
              <p className="text-muted-foreground text-xs">
                {rule.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
