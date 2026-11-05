import { SOKO_BOT_PROACTIVE_RULES } from "@sokosumi/soko-bot";
import { useTranslations } from "next-intl";

/**
 * Every trigger that can make the assistant act on its own. Its rhythms are
 * listed under Schedules. Text is single-sourced from @sokosumi/soko-bot so
 * the page and the behaviour cannot drift.
 */
export function HowItWorks() {
  const t = useTranslations("App.SokoBot.HowItWorks");
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">{t("triggers")}</p>
      <ul className="space-y-3">
        {SOKO_BOT_PROACTIVE_RULES.map((rule) => (
          <li key={rule.id} className="text-sm">
            <p className="font-medium">{rule.title}</p>
            <p className="text-muted-foreground text-xs">{rule.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
