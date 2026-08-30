import { getFormatter, getTranslations } from "next-intl/server";

import { sokoBotService } from "@/lib/services/soko-bot.service";

/**
 * What the bot has spent. Credits lead because that is what leaves the owner's
 * balance; the token counts and the raw model cost sit underneath because they
 * do not add up to the same number — billing applies a per-turn floor, so a
 * turn costing a fraction of a cent still charges the minimum.
 */
export async function SokoBotUsageCard() {
  const [t, format, usage] = await Promise.all([
    getTranslations("App.SokoBots.Usage"),
    getFormatter(),
    sokoBotService.getMyUsage().catch(() => null),
  ]);
  if (!usage) return null;

  const numbers = (value: number) => format.number(value);
  // Two decimals would report four tenths of a cent as "$0.00", which reads as
  // "this cost nothing" on the one page whose job is to say what it cost.
  const money = format.number(usage.costUsd, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: usage.costUsd > 0 && usage.costUsd < 0.01 ? 4 : 2,
  });

  return (
    <section className="space-y-3">
      <h2 className="text-foreground text-lg font-medium">{t("title")}</h2>
      <div className="bg-background grid gap-6 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground text-xs">{t("credits")}</p>
          <p className="text-foreground text-2xl font-medium tabular-nums">
            {numbers(usage.credits)}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("turns", { count: usage.turns })}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t("tokens")}</p>
          <p className="text-foreground text-2xl font-medium tabular-nums">
            {numbers(usage.totalTokens)}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("tokenSplit", {
              input: numbers(usage.inputTokens),
              output: numbers(usage.outputTokens),
            })}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t("modelCost")}</p>
          <p className="text-foreground text-2xl font-medium tabular-nums">
            {money}
          </p>
          <p className="text-muted-foreground text-xs">{t("modelCostHint")}</p>
        </div>
      </div>
    </section>
  );
}
