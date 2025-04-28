"use client";

import { CircleCheck, Loader2, SquareTerminal } from "lucide-react";
import { useTranslations } from "next-intl";

import useAgentJobs from "@/hooks/use-agent-jobs";
import { AgentWithRelations, getAgentAuthorName } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection2({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card2");
  const {
    executedJobs,
    loading: jobsLoading,
    error: jobsError,
  } = useAgentJobs(agent.id);

  return (
    <CardSection>
      <div className="grid grid-cols-2">
        {/* Developer */}
        <div className="flex flex-col gap-0.5 border-r pr-6">
          <div className="flex items-center gap-1.5">
            <SquareTerminal size={16} />
            <span className="text-upper text-xs">{t("developer")}</span>
          </div>
          <p className="text-base font-medium">{getAgentAuthorName(agent)}</p>
        </div>
        {/* Executed Jobs */}
        <div className="flex flex-col gap-0.5 px-6">
          <div className="flex items-center gap-1.5">
            <CircleCheck size={16} />
            <span className="text-upper text-xs">{t("executedJobs")}</span>
          </div>
          {jobsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : jobsError ? (
            <span className="text-upper text-xs">
              {t("unknownExecutedJobs")}
            </span>
          ) : (
            <p className="text-base font-medium">
              {t("executedJobsCount", { count: executedJobs.length })}
            </p>
          )}
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection2 };
