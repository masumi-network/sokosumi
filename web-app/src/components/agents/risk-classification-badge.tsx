import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { RiskClassification } from "@/prisma/generated/client";

export const RISK_CLASSIFICATION_MAP = {
  MINIMAL: {
    labelKey: "minimal",
    variant: "default",
    color: "bg-green-600 text-white dark:bg-green-500",
  },
  LIMITED: {
    labelKey: "limited",
    variant: "secondary",
    color: "bg-yellow-500 text-white dark:bg-yellow-400",
  },
  HIGH: {
    labelKey: "high",
    variant: "outline",
    color: "bg-orange-500 text-white dark:bg-orange-400",
  },
  UNACCEPTABLE: {
    labelKey: "unacceptable",
    variant: "destructive",
    color: "bg-red-600 text-white dark:bg-red-500",
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
