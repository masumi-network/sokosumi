"use client";

import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import {
  AgentActionButtons,
  AgentActionButtonsSkeleton,
} from "@/components/agents/agent-action-buttons";
import { AgentIcon } from "@/components/agents/agent-icon";
import { AgentVerifiedBadge } from "@/components/agents/agent-verified-badge";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAgentName,
  getAgentResolvedIcon,
  getFullAgentAuthorName,
} from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

interface AgentDetailHeaderProps {
  agent: CoreAgentDto;
  myJobsCount?: number | undefined;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

/** Opens New task with this agent @-mentioned in the prompt. The reader picks
 * the coworker, reviews the cost and submits; nothing runs from here. */
function StartTaskButton({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  const t = useTranslations("Components.Agents.ActionButtons");
  const openNewTask = useNewTaskOpener({ prompt: `@${agentId} ` });
  if (!openNewTask) return null;
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className={cn("h-10 md:h-8", className)}
      onClick={openNewTask}
    >
      <Plus aria-hidden />
      {t("startTask")}
    </Button>
  );
}

function AgentDetailHeader({
  agent,
  myJobsCount = 0,
  showBackButton,
  showCloseButton,
  onClose,
}: AgentDetailHeaderProps) {
  const tJobsHeader = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden w-full md:block">
        <div className="flex w-full items-center justify-between">
          {showBackButton && (
            <BackLink
              href="/agents"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm text-nowrap transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>{tJobsHeader("back")}</span>
            </BackLink>
          )}
          <AgentActionButtons
            agent={agent}
            showBackButton={false}
            showCloseButton={showCloseButton}
            onClose={onClose}
            trailingActions={<StartTaskButton agentId={agent.id} />}
          />
        </div>
      </div>
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="border-border bg-card-background flex size-24 shrink-0 items-center justify-center rounded-lg border md:size-32">
          <AgentIcon
            agent={{
              name: getAgentName(agent),
              icon: getAgentResolvedIcon(agent),
            }}
            className="size-14 md:size-16"
          />
        </div>
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <h1 className="text-xl leading-tight font-semibold tracking-tight md:text-3xl">
                {getAgentName(agent)}
              </h1>
              <AgentVerifiedBadge />
            </div>
            {myJobsCount > 0 ? (
              <Link
                href={`/agents/${agent.id}/jobs`}
                className="border-border bg-card-background hover:bg-quinary focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-md border py-1.5 pr-2 pl-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
              >
                <span>{tJobsHeader("yourJobs")}</span>
                <span className="bg-muted text-muted-foreground rounded-full px-2 text-xs tabular-nums">
                  {myJobsCount}
                </span>
                <ChevronRight
                  className="text-muted-foreground size-4"
                  aria-hidden
                />
              </Link>
            ) : null}
            <div className="flex items-center gap-3">
              <div className="relative size-8">
                <Image
                  src="/images/agent/agent-detail-author.jpg"
                  alt="author"
                  fill
                  sizes="100px"
                  className="rounded-full object-cover"
                />
              </div>
              <p className="text-muted-foreground text-sm md:text-base">
                {getFullAgentAuthorName(agent)}
              </p>
            </div>
            {/* Phones hide the action row above; the button lives here. */}
            <StartTaskButton agentId={agent.id} className="w-full md:hidden" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDetailHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <AgentActionButtonsSkeleton />
      <div className="flex flex-col gap-6 md:flex-row">
        <Skeleton className="size-24 rounded-lg md:size-32" />
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { AgentDetailHeader, AgentDetailHeaderSkeleton };
