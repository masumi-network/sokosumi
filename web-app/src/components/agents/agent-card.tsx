"use client";

import { CheckCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentDescription,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import { AgentBookmarkButton } from "./agent-bookmark-button";

interface AgentCardSkeletonProps {
  className?: string | undefined;
}

function AgentCardSkeleton({ className }: AgentCardSkeletonProps) {
  return (
    <Card
      className={cn(
        "flex w-72 flex-col overflow-hidden py-0 sm:w-96",
        className,
      )}
    >
      <div className="bg-muted relative h-48 w-full shrink-0 animate-pulse" />
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <div className="bg-muted h-6 w-32 animate-pulse rounded" />
          <div className="bg-muted h-4 w-4 animate-pulse rounded-full" />
          <div className="bg-muted h-4 w-16 animate-pulse rounded" />
        </div>
        <div className="bg-muted h-16 w-full animate-pulse rounded" />
        <div className="flex items-center gap-2">
          <div className="bg-muted h-5 w-24 animate-pulse rounded" />
          <div className="bg-muted h-5 w-32 animate-pulse rounded" />
        </div>
      </div>
    </Card>
  );
}

interface AgentCardProps {
  agent: AgentWithRelations;
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
  className?: string | undefined;
}

function AgentCard({
  agent,
  agentList,
  agentCreditsPrice,
  className,
}: AgentCardProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  const description = getAgentDescription(agent);

  let pathname = usePathname();

  if (pathname === "/") {
    pathname = "agents";
  }

  return (
    <Link href={`${pathname}/${agent.id}`}>
      <Card
        className={cn(
          "group bg-background relative flex w-72 flex-col gap-4 rounded-lg border-none p-0 shadow-none",
          className,
        )}
      >
        {/* Bookmark Button (hover only) */}
        {agentList && (
          <div
            className="absolute top-3 right-3 z-20 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
          >
            <AgentBookmarkButton agentId={agent.id} agentList={agentList} />
          </div>
        )}

        {/* Image */}
        <div className="shadow-foreground/10 aspect-[1.6] w-full overflow-hidden rounded-lg shadow-lg">
          <Image
            src={getAgentResolvedImage(agent)}
            alt={`${getAgentName(agent)} image`}
            width={400}
            height={250}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>

        {/* Content */}
        <div className="pt-1, px-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-medium">{getAgentName(agent)}</h3>
            <div className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1">
              <CheckCheck className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground text-xs uppercase">
                {"Verified"}
              </span>
            </div>
          </div>
          {description && (
            <p className="text-muted-foreground mb-4 text-sm">{description}</p>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">
              {t("pricing", {
                price: convertCentsToCredits(agentCreditsPrice.cents),
              })}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export { AgentCard, AgentCardSkeleton };
