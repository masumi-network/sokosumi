"use client";

import { useTranslations } from "next-intl";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoCopyButton, seoActionDetails } from "./seo-action-copy";
import type { SeoPlanMessageModel } from "./seo-plan-message-model";

type PlanHandoffProps = {
  message: SeoPlanMessageModel;
  reportLabel: string;
  websiteUrl: string | null;
};

/** The clipboard receives only the selected plan and the actions attached to its steps. */
export function SeoPlanHandoff({
  message,
  reportLabel,
  websiteUrl,
}: PlanHandoffProps) {
  const ui = useTranslations("App.Seo");
  const t = useSeoResultTranslations("App.Seo");
  const steps = message.steps.map((step, index) => {
    const actions = step.actions.map((action) =>
      [
        t(`actions.${action.status}`),
        seoActionDetails(t, action, action.why),
      ].join("\n"),
    );
    return [
      `${index + 1}. ${step.action}`,
      step.pageUrl,
      step.why,
      step.order && `${t("planMessage.order")} ${step.order}`,
      step.window && t("planMessage.window", { month: step.window }),
      step.queries?.length &&
        t("reportPlan.queries", { queries: step.queries.join(", ") }),
      step.ideas?.length &&
        `${t("planMessage.ideas")}:\n${step.ideas.join("\n")}`,
      step.wording && `${t("planMessage.wording")}: ${step.wording}`,
      ...actions,
      `${t("actions.nextCheck")}: ${step.nextCheck}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  });
  const text = [
    t("planMessage.handoffLead"),
    [websiteUrl, reportLabel].filter(Boolean).join(" · "),
    message.strategy,
    ...steps,
    message.revisit && `${t("planMessage.revisit")}: ${message.revisit}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <SeoCopyButton
      text={text}
      label={ui("actions.copyInstructions")}
      variant="primary"
      className="min-h-11 max-w-full whitespace-normal"
    />
  );
}
