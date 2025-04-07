import { Star } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  getAverageStars,
  getDescription,
  getName,
  getResolvedImage,
  getTags,
} from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/services/agent.service";
import { AgentListWithAgent } from "@/lib/db/services/agentList.service";
import { cn } from "@/lib/utils";

import { AgentBookmarkButton } from "./agent-bookmark-button";
import AgentCardButton from "./agent-card-button";
import { BadgeCloud } from "./badge-cloud";

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

      <CardContent className="flex flex-1 flex-col px-6 pb-3">
        <div className="mb-2 flex shrink-0 gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted h-5 w-5 animate-pulse rounded-full"
            />
          ))}
        </div>

        <div className="bg-muted mb-2 h-7 w-3/4 shrink-0 animate-pulse rounded" />
        <div className="bg-muted mb-3 h-16 w-full shrink-0 animate-pulse rounded" />
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted h-6 w-20 animate-pulse rounded-full"
            />
          ))}
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-muted h-10 w-24 animate-pulse rounded" />
            <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-9 w-9 animate-pulse rounded" />
        </div>
      </CardFooter>
    </Card>
  );
}

interface AgentCardProps {
  agent: AgentWithRelations;
  agentList?: AgentListWithAgent | undefined;
  agentPrice: number;
  className?: string | undefined;
}

function AgentCard({
  agent,
  agentPrice,
  agentList,
  className,
}: AgentCardProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  const averageStars = getAverageStars(agent);
  const description = getDescription(agent);
  return (
    <Card
      className={cn(
        "flex w-72 flex-col overflow-hidden py-0 sm:w-96",
        className,
      )}
    >
      <div className="relative h-48 w-full shrink-0">
        <Image
          src={getResolvedImage(agent)}
          alt={`${getName(agent)} image`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover"
        />
      </div>

      <CardContent className="flex flex-1 flex-col px-6 pb-3">
        {averageStars !== null && (
          <div
            className="mb-2 flex shrink-0"
            aria-label={`Rating: ${averageStars} out of 5 stars`}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-5 w-5 ${i < averageStars ? "fill-primary text-primary" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        <h3 className="mb-2 shrink-0 text-xl font-bold">{getName(agent)}</h3>
        {description && (
          <p className="text-muted-foreground mb-3 line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal">
            {description}
          </p>
        )}
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap overflow-hidden">
          <BadgeCloud tags={getTags(agent)} />
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <AgentCardButton agentId={agent.id} />

            <div>
              <p className="text-muted-foreground text-s">
                {t("pricing", { price: agentPrice })}
              </p>
            </div>
          </div>
          {agentList && (
            <AgentBookmarkButton agentId={agent.id} agentList={agentList} />
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

export { AgentCard, AgentCardSkeleton };
