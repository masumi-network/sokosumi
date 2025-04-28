import Image from "next/image";
import { useTranslations } from "next-intl";

import {
  AgentBadgeCloud,
  AgentHireButton,
  AgentModalTrigger,
  AgentVerifiedBadge,
} from "@/components/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentDescription,
  getAgentName,
  getAgentResolvedImage,
  getAgentTags,
} from "@/lib/db";

export function FeaturedAgentSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Image Section - 1/2 width */}
      <div className="relative aspect-16/9 w-full overflow-hidden rounded-lg md:w-1/2">
        <Skeleton className="h-full w-full" />
      </div>

      {/* Text Content Section - 1/2 width */}
      <div className="w-full space-y-6 md:w-1/2">
        <Skeleton className="h-8 w-32" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-48" />
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="flex flex-wrap gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-6 w-16" />
          ))}
        </div>
        <Skeleton className="h-11 w-full md:w-32" />
      </div>
    </div>
  );
}

interface FeaturedAgentProps {
  agent: AgentWithRelations;
  creditsPrice: CreditsPrice;
}

export function FeaturedAgent({ agent, creditsPrice }: FeaturedAgentProps) {
  const t = useTranslations("Landing.Agents.FeaturedAgent");

  return (
    <div className="flex flex-col items-center gap-8 md:h-96 md:flex-row">
      {/* Image Section - 1/2 width */}
      <div className="relative h-72 w-full overflow-clip md:h-full md:w-1/2">
        <Image
          src={getAgentResolvedImage(agent)}
          alt={`${getAgentName(agent)} image`}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="rounded-lg object-cover"
          priority
        />
      </div>

      {/* Text Content Section - 1/2 width */}
      <div className="flex w-full flex-col gap-12 md:w-1/2">
        <div>
          <AgentBadgeCloud tags={getAgentTags(agent)} />
          <div className="relative">
            <div className="flex items-start gap-1">
              <h3 className="line-clamp-2 text-5xl leading-tight font-light">
                {getAgentName(agent)}
              </h3>
              <AgentVerifiedBadge className="m-auto" />
            </div>
          </div>
          <div className="text-muted-foreground line-clamp-3 text-5xl leading-tight font-light">
            {getAgentDescription(agent)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-base">
            <span className="font-medium">
              {t("pricing", {
                credits: convertCentsToCredits(creditsPrice.cents),
              })}
            </span>
          </div>
          <div className="flex gap-2">
            <AgentModalTrigger agentId={agent.id}>
              <Button size="lg" variant="secondary">
                {t("view")}
              </Button>
            </AgentModalTrigger>
            <AgentHireButton agentId={agent.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
