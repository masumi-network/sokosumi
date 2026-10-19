import { useTranslations } from "next-intl";
import * as z from "zod";

import {
  budgetStep,
  currencyFractionDigits,
  hasValidPrecision,
} from "@/lib/ads/campaign";

/**
 * What both budget forms share: the label, the input's step, the schema for
 * the typed amount and the message for a refused precision, all in the
 * currency's terms ("Use a whole number for JPY.").
 */
export function useAdsBudget(currency: string) {
  const t = useTranslations("App.Ads.campaigns.budget");
  const digits = currencyFractionDigits(currency);
  const precisionMessage =
    digits === 0
      ? t("wholeNumber", { currency })
      : t("precision", { digits, currency });

  const schema = z.string().superRefine((value, ctx) => {
    const amount = Number(value);
    if (value.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
      ctx.addIssue({ code: "custom", message: t("required") });
    } else if (!hasValidPrecision(amount, digits)) {
      ctx.addIssue({ code: "custom", message: precisionMessage });
    }
  });

  return {
    label: t("label", { currency }),
    precisionMessage,
    schema,
    step: budgetStep(digits),
  };
}
