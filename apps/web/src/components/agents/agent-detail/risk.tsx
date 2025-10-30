import { AgentWithRelations } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { RiskClassificationBadge } from "@/components/agents/risk-classification-badge";
import { Skeleton } from "@/components/ui/skeleton";

function AgentDetailRisk({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentDetail.Risk");

  return (
    <div>
      <p className="mb-2 text-xs uppercase">{t("title")}</p>
      <RiskClassificationBadge riskClassification={agent.riskClassification} />
    </div>
  );
}

function AgentDetailRiskSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="h-6 w-32" />
    </div>
  );
}

export { AgentDetailRisk, AgentDetailRiskSkeleton };
