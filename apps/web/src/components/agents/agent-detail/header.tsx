"use client";

import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import {
  AgentActionButtons,
  AgentActionButtonsSkeleton,
} from "@/components/agents/agent-action-buttons";
import { AgentDemoButton } from "@/components/agents/agent-demo-button";
import { AgentHireButton } from "@/components/agents/agent-hire-button";
import AgentIcon from "@/components/agents/agent-icon";
import { AgentVerifiedBadge } from "@/components/agents/agent-verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import useIsClient from "@/hooks/use-is-client";
import {
  getAgentCategoryStyles,
  getAgentDemoData,
  getAgentName,
  getAgentResolvedIcon,
  getFullAgentAuthorName,
} from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { getAgentCredits } from "@/lib/types/core-dto";
import { generateGradientBorder } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { getCategoryColor } from "@/lib/utils/theme";

interface AgentDetailHeaderProps {
  agent: CoreAgentDto;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

function AgentDetailHeader({
  agent,
  showBackButton,
  showCloseButton,
  onClose,
}: AgentDetailHeaderProps) {
  const t = useTranslations("Components.Agents.AgentDetail.Header");
  const tJobsHeader = useTranslations("App.Agents.Jobs.Header");
  const { resolvedTheme } = useTheme();
  const isClient = useIsClient();
  const agentDemoData = getAgentDemoData(agent);
  const categoryStyles = getAgentCategoryStyles(agent);
  const currentTheme = isClient && resolvedTheme === "dark" ? "dark" : "light";
  const gradientBorder = useMemo(
    () =>
      isClient ? generateGradientBorder(categoryStyles, currentTheme) : null,
    [isClient, categoryStyles, currentTheme],
  );
  const categoryColor = useMemo(
    () => getCategoryColor(categoryStyles, currentTheme),
    [categoryStyles, currentTheme],
  );
  const iconBorderStyle =
    isClient && gradientBorder
      ? {
          border: "0.2px solid transparent",
          borderRadius: "0.5rem",
          backgroundImage: `linear-gradient(var(--card-background), var(--card-background)), ${gradientBorder}`,
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden w-full md:block">
        <div className="flex w-full items-center justify-between">
          {showBackButton && (
            <Link
              href="/agents"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm text-nowrap transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>{tJobsHeader("back")}</span>
            </Link>
          )}
          <AgentActionButtons
            agent={agent}
            showBackButton={false}
            showCloseButton={showCloseButton}
            onClose={onClose}
          />
        </div>
      </div>
      <div className="flex flex-col gap-6 md:flex-row">
        <div
          className="border-border bg-card-background flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border md:h-32 md:w-32"
          style={iconBorderStyle}
        >
          <div style={{ color: categoryColor }}>
            <AgentIcon
              agent={{
                name: getAgentName(agent),
                icon: getAgentResolvedIcon(agent),
              }}
              className="size-14 md:size-16"
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <h1
                className="text-xl leading-tight font-semibold tracking-tight md:text-3xl"
                style={{ color: categoryColor }}
              >
                {getAgentName(agent)}
              </h1>
              <AgentVerifiedBadge />
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8">
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
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm md:text-base">
              <span className="font-medium">
                {t("pricing", {
                  credits: formatCreditsForDisplay(getAgentCredits(agent)),
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {agentDemoData && <AgentDemoButton agentId={agent.id} />}
              <AgentHireButton agentId={agent.id} />
            </div>
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
        <Skeleton className="h-24 w-24 rounded-lg md:h-32 md:w-32" />
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-base">
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

export { AgentDetailHeader, AgentDetailHeaderSkeleton };
