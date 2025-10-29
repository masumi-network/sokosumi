import { useTranslations } from "next-intl";

import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
import Markdown from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  getAgentDescription,
  getAgentTags,
} from "@/lib/db";

function AgentDetailOverview({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentDetail.Overview");
  const agentDescription = getAgentDescription(agent);
  const tags = getAgentTags(agent);

  return (
    <div className="flex flex-col gap-10">
      {agentDescription && (
        <div>
          <p className="mb-2 text-xs uppercase">{t("description")}</p>
          <Markdown>{agentDescription}</Markdown>
        </div>
      )}
      {tags.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase">{t("tags")}</p>
          <AgentBadgeCloud tags={tags} />
        </div>
      )}
    </div>
  );
}

function AgentDetailOverviewSkeleton() {
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

export { AgentDetailOverview, AgentDetailOverviewSkeleton };
