import { useTranslations } from "next-intl";
import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgentDescription, getAgentTags } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

function AgentDetailOverview({ agent }: { agent: CoreAgentDto }) {
  const t = useTranslations("Components.Agents.AgentDetail.Overview");
  const tTaskDetail = useTranslations("App.Tasks.Detail");
  const agentDescription = getAgentDescription(agent);
  const tags = getAgentTags(agent);

  return (
    <div className="flex flex-col gap-8">
      {agentDescription && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground/60 text-xs font-medium">
            {t("description")}
          </h2>
          <ExpandableMarkdown
            content={agentDescription}
            className="text-foreground/80"
            expandLabel={tTaskDetail("expand")}
            collapseLabel={tTaskDetail("collapse")}
            fadeClassName="to-background"
          />
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {t("tags")}
        </h2>
        {tags.length > 0 ? (
          <AgentBadgeCloud tags={tags} />
        ) : (
          <p className="text-muted-foreground/40 text-sm">—</p>
        )}
      </section>
    </div>
  );
}

function AgentDetailOverviewSkeleton() {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-32 w-full" />
      </section>
      <section className="space-y-2">
        <Skeleton className="h-4 w-12" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-4 w-8" />
          ))}
        </div>
      </section>
    </div>
  );
}

export { AgentDetailOverview, AgentDetailOverviewSkeleton };
