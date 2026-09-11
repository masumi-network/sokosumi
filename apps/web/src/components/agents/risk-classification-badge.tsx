import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { MARKER_ICONS } from "@/components/ui/status-marker";
import type { RiskClassification } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

/**
 * Four ordered tiers with four distinct silhouettes, so the escalation does
 * not depend on telling amber from orange. The lower two are a tint, the upper
 * two are solid, and the glyph steps shield to triangle to octagon the way
 * road signs do.
 *
 * On the solid tiers the glyph takes the label colour, not the hue: a marker
 * in the fill colour has nothing to separate against. `--risk-high-foreground`
 * on `--risk-high` measures 9.22:1.
 */
export const RISK_CLASSIFICATION_MAP = {
  MINIMAL: {
    labelKey: "minimal",
    color: "bg-semantic-success-quaternary border-transparent text-foreground",
    icon: MARKER_ICONS.riskMinimal,
    iconColor: "text-semantic-success",
  },
  LIMITED: {
    labelKey: "limited",
    color: "bg-semantic-warning-quaternary border-transparent text-foreground",
    icon: MARKER_ICONS.riskLimited,
    iconColor: "text-semantic-warning",
  },
  HIGH: {
    labelKey: "high",
    color: "bg-risk-high text-risk-high-foreground border-transparent",
    icon: MARKER_ICONS.riskHigh,
    iconColor: "text-risk-high-foreground",
  },
  UNACCEPTABLE: {
    labelKey: "unacceptable",
    color:
      "bg-semantic-destructive-solid text-semantic-destructive-foreground border-transparent",
    icon: MARKER_ICONS.riskUnacceptable,
    iconColor: "text-semantic-destructive-foreground",
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
      <config.icon
        aria-hidden="true"
        strokeWidth={2.25}
        className={cn("size-3.5 shrink-0", config.iconColor)}
      />
      {t(config.labelKey)}
    </Badge>
  );
}
