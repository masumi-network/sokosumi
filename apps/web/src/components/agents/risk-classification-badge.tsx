import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { MARKER_ICONS } from "@/components/ui/status-marker";
import type { RiskClassification } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

/**
 * Four ordered tiers with four distinct silhouettes, so the escalation does
 * not depend on colour. The lower two are the neutral chip, high is the
 * guide's yellow ! and unacceptable its Neutral 950 X, and the glyph steps
 * shield to triangle to octagon the way road signs do.
 *
 * On the solid tiers the glyph takes the label colour: Neutral 950 on yellow
 * measures 13.57:1.
 */
const RISK_CLASSIFICATION_MAP = {
  MINIMAL: {
    labelKey: "minimal",
    color: "bg-muted border-border text-foreground",
    icon: MARKER_ICONS.riskMinimal,
    iconColor: "text-foreground",
  },
  LIMITED: {
    labelKey: "limited",
    color: "bg-muted border-border text-foreground",
    icon: MARKER_ICONS.riskLimited,
    iconColor: "text-foreground",
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
      // Badge sets [&>svg]:size-3 on the parent, and `.badge > svg` outranks
      // the size-3.5 on the glyph itself. Restated here, where className
      // merges last and wins, so the risk shields match every other marker.
      className={cn(config.color, "[&>svg]:size-3.5")}
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
