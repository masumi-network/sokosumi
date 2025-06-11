import { useTranslations } from "next-intl";

import { RiskClassificationBadge } from "@/components/agents/risk-classification-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentWithRelations } from "@/lib/db";

function AgentDetailSection6({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentDetail.Section6");

  return (
    <div>
      <p className="mb-2 text-xs uppercase">{t("title")}</p>
      <RiskClassificationBadge riskClassification={agent.riskClassification} />
    </div>
  );
}

function AgentDetailSection6Skeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="h-6 w-32" />
    </div>
  );
}

export { AgentDetailSection6, AgentDetailSection6Skeleton };
