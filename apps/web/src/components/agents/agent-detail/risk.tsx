import { useTranslations } from "next-intl";
import { RiskClassificationBadge } from "@/components/agents/risk-classification-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { isCoreAgentDetail } from "@/lib/types/core-dto";

function AgentDetailRisk({ agent }: { agent: CoreAgentDto }) {
  const t = useTranslations("Components.Agents.AgentDetail.Risk");

  if (!isCoreAgentDetail(agent)) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {t("title")}
      </h2>
      <RiskClassificationBadge riskClassification={agent.riskClassification} />
    </div>
  );
}

function AgentDetailRiskSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-32" />
    </div>
  );
}

export { AgentDetailRisk, AgentDetailRiskSkeleton };
