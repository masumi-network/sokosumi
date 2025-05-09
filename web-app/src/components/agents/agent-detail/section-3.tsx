import { useTranslations } from "next-intl";

import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  getAgentDescription,
  getAgentTags,
} from "@/lib/db";

function AgentDetailSection3({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentDetail.Section3");
  const agentDescription = getAgentDescription(agent);

  return (
    <div className="flex flex-col gap-2">
      {agentDescription && (
        <>
          <p className="text-xs uppercase">{t("title1")}</p>
          <p className="mb-10">{getAgentDescription(agent)}</p>
        </>
      )}
      <p className="mb-2 text-xs uppercase">{t("title2")}</p>
      <AgentBadgeCloud tags={getAgentTags(agent)} />
    </div>
  );
}

function AgentDetailSection3Skeleton() {
  return (
    <div>
      <Skeleton className="h-4 w-12" />
      <Skeleton className="mt-2 mb-10 h-32 w-full" />
      <Skeleton className="h-4 w-12" />
      <div className="mt-2 flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-8" />
        ))}
      </div>
    </div>
  );
}

export { AgentDetailSection3, AgentDetailSection3Skeleton };
