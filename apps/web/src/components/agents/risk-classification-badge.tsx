import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { RiskClassification } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

/**
 * Four ordered tiers, so colour alone cannot carry the escalation: the warm
 * hues sit too close together to separate on hue. Fill weight is the second
 * channel. The lower two tiers are a tint with a coloured dot, the upper two
 * are solid, which makes Medium to High the step a reader notices. No tier
 * draws a border: the tint itself carries the badge edge now that it is a
 * -quaternary step, and a border on two of four tiers read as a fifth state.
 *
 * The label stays in the foreground colour on the tinted tiers. A coloured
 * label would need 4.5:1, and there is no vivid amber that reaches it on
 * white — that constraint is what turns amber into mud. The dot only needs
 * 3:1 (WCAG 2.2 SC 1.4.11), so the colour stays vivid there instead.
 */
export const RISK_CLASSIFICATION_MAP = {
  MINIMAL: {
    labelKey: "minimal",
    color: "bg-semantic-success-quaternary border-transparent text-foreground",
    dot: "bg-semantic-success",
  },
  LIMITED: {
    labelKey: "limited",
    color: "bg-semantic-warning-quaternary border-transparent text-foreground",
    dot: "bg-semantic-warning",
  },
  HIGH: {
    labelKey: "high",
    color: "bg-risk-high text-risk-high-foreground border-transparent",
    dot: null,
  },
  UNACCEPTABLE: {
    labelKey: "unacceptable",
    color:
      "bg-semantic-destructive text-semantic-destructive-foreground border-transparent",
    dot: null,
  },
} as const;

export interface RiskClassificationBadgeProps {
  riskClassification: RiskClassification;
}

export function RiskClassificationBadge({
  riskClassification,
}: RiskClassificationBadgeProps) {
  const t = useTranslations("Components.Agents.RiskClassification");
  const config =
    RISK_CLASSIFICATION_MAP[riskClassification] ??
    RISK_CLASSIFICATION_MAP.MINIMAL;
  return (
    <Badge
      variant="outline"
      className={cn(config.color)}
      aria-label={t(config.labelKey)}
    >
      {config.dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", config.dot)}
        />
      ) : null}
      {t(config.labelKey)}
    </Badge>
  );
}
