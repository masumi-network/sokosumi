import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AgentIcon } from "@/components/agents/agent-icon";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

interface JobsListHeaderProps {
  agent: CoreAgentDto;
  /** All of the viewer's jobs with this agent, not just the loaded page. */
  total: number;
}

/**
 * Names whose jobs these are. The Back link only shows while the list stands
 * alone on a tablet-width pane: with two panes the job's header on the right
 * carries it, and below md the app's top bar Back goes to the same agent
 * (`resolveMobileAppBackTarget`).
 */
export function JobsListHeader({ agent, total }: JobsListHeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");
  const name = getAgentName(agent);

  return (
    <div className="flex flex-col gap-3 px-2 pb-3 md:px-0 md:pr-4">
      <div className="max-md:hidden @4xl/jobs-panes:hidden">
        <Link
          href={`/agents/${agent.id}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit max-w-full items-center gap-1.5 rounded-sm text-sm transition-colors outline-none focus-visible:ring-2"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t("backToAgent", { name })}</span>
        </Link>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <div className="border-border bg-card-background flex size-10 shrink-0 items-center justify-center rounded-lg border">
          <AgentIcon
            agent={{ name, icon: getAgentResolvedIcon(agent) }}
            className="size-5"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base leading-tight font-semibold">
            {name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("yourJobsCount", { count: total })}
          </p>
        </div>
      </div>
    </div>
  );
}
