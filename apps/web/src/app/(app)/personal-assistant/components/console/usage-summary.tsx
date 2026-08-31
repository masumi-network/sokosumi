"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { SokoBotUsage } from "@/lib/clients/generated/core";

/**
 * What this bot has spent, for its owner.
 *
 * Credits lead because that is what leaves their balance. The token counts and
 * the raw model cost sit underneath and deliberately do not reconcile with it:
 * billing applies a per-turn floor, so a turn costing a fraction of a cent
 * still charges the minimum, and hiding that gap only invites the question.
 */
export function UsageSummary({ usage }: { usage: SokoBotUsage }) {
  const t = useTranslations("App.SokoBot.Console.Usage");
  const format = useFormatter();

  const cells = [
    {
      label: t("credits"),
      value: format.number(usage.credits),
      hint: t("turns", { count: usage.turns }),
    },
    {
      label: t("tokens"),
      value: format.number(usage.totalTokens),
      hint: t("tokenSplit", {
        input: format.number(usage.inputTokens),
        output: format.number(usage.outputTokens),
      }),
    },
    {
      label: t("modelCost"),
      // Two decimals would report four tenths of a cent as "$0.00" in the one
      // place whose job is to say what things cost.
      value: format.number(usage.costUsd, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits:
          usage.costUsd > 0 && usage.costUsd < 0.01 ? 4 : 2,
      }),
      hint: t("modelCostHint"),
    },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-muted-foreground text-xs">{cell.label}</p>
          <p className="text-foreground text-2xl font-medium tabular-nums">
            {cell.value}
          </p>
          <p className="text-muted-foreground text-xs">{cell.hint}</p>
        </div>
      ))}
    </div>
  );
}
