"use client";

import type { SokoBotUsage } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * What this bot has spent, for its owner.
 *
 * Credits lead because that is what leaves their balance: its own turns plus
 * the Coworker Tasks and Agents it started. With `detailed`, the raw model
 * cost sits beside it and deliberately does not reconcile: billing applies a
 * per-turn floor, so a turn costing a fraction of a cent still charges the
 * minimum, and hiding that gap only invites the question.
 */
export function UsageSummary({
  usage,
  detailed = false,
}: {
  usage: SokoBotUsage;
  detailed?: boolean;
}) {
  const t = useTranslations("App.SokoBot.Console.Usage");
  const format = useFormatter();

  const split =
    usage.delegatedCredits > 0
      ? t("creditSplit", {
          own: format.number(usage.credits),
          delegated: format.number(usage.delegatedCredits),
        })
      : t("creditsOwnOnly");
  const cells = [
    {
      label: t("credits"),
      value: format.number(usage.totalCredits),
      hint: detailed
        ? `${split} · ${t("turns", { count: usage.turns })}`
        : split,
    },
    {
      label: t("tokens"),
      value: format.number(usage.totalTokens),
      hint: t("tokenSplit", {
        input: format.number(usage.inputTokens),
        output: format.number(usage.outputTokens),
      }),
    },
    ...(detailed
      ? [
          {
            label: t("modelCost"),
            // Two decimals would report four tenths of a cent as "$0.00" in
            // the one place whose job is to say what things cost.
            value: format.number(usage.costUsd, {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
              maximumFractionDigits:
                usage.costUsd > 0 && usage.costUsd < 0.01 ? 4 : 2,
            }),
            hint: t("modelCostHint"),
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn(
        "grid gap-6",
        detailed ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-muted-foreground text-xs">{cell.label}</p>
          <p className="text-foreground text-2xl font-medium tabular-nums tracking-tight">
            {cell.value}
          </p>
          <p className="text-muted-foreground text-xs">{cell.hint}</p>
        </div>
      ))}
    </div>
  );
}
