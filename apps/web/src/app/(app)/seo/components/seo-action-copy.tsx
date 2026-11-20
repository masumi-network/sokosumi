"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useClipboard } from "@/hooks/use-clipboard";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";

/** A button that copies one text, and says so for a moment. */
export function SeoCopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations("App.Seo");
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("actions.copied"),
    copyErrorMessage: t("actions.copyFailed"),
  });
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      onClick={() => {
        void copy(text);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}

/**
 * The action as plain text for a coding agent: what to do first, then what to change, where, why, and the
 * change itself when the check has one.
 */
export function useSeoActionInstructions(
  action: ProjectSeoAction,
  finding: string,
): string {
  const t = useSeoResultTranslations("App.Seo");
  return [
    t("actions.copyAgentLead"),
    action.title,
    `${t("actions.copyPage")}: ${action.pageUrl}`,
    finding,
    // Without an issue behind it the finding line is the effect: it is not said twice.
    action.decision || finding === action.expectedEffect
      ? null
      : `${t("actions.effect")}: ${action.expectedEffect}`,
    finding === action.why ? null : action.why,
    action.decision
      ? `${t("actions.alternative")}: ${action.decision.alternative}`
      : null,
    action.decision
      ? `${t("actions.nextCheck")}: ${action.decision.nextCheck}`
      : null,
    action.evidence.length
      ? action.evidence.map((line) => `- ${line}`).join("\n")
      : null,
    action.edit ? `${t("actions.after")}:\n${action.edit.after}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
