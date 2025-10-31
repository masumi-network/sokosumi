import { RiskClassification } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

export const RISK_CLASSIFICATION_MAP = {
  MINIMAL: {
    labelKey: "minimal",
    variant: "default",
    color: "bg-semantic-success text-semantic-success-foreground",
  },
  LIMITED: {
    labelKey: "limited",
    variant: "secondary",
    color: "bg-semantic-warning text-semantic-warning-foreground",
  },
  HIGH: {
    labelKey: "high",
    variant: "outline",
    color: "bg-semantic-critical text-semantic-critical-foreground",
  },
  UNACCEPTABLE: {
    labelKey: "unacceptable",
    variant: "destructive",
    color: "bg-semantic-destructive text-semantic-destructive-foreground",
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
      variant={config.variant}
      className={config.color}
      aria-label={t(config.labelKey)}
    >
      {t(config.labelKey)}
    </Badge>
  );
}
