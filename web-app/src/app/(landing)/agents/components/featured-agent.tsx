import { CheckCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BadgeCloud } from "@/components/agents";
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

import FeaturedAgentHireButton from "./featured-agent-hire-button";

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
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Image Section - 1/2 width */}
      <div className="relative aspect-16/9 w-full md:w-1/2">
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
      <div className="w-full space-y-6 md:w-1/2">
        <div className="space-y-4">
          <BadgeCloud tags={getAgentTags(agent)} />
          <div className="flex items-center gap-2">
            <h3 className="text-5xl font-light">{getAgentName(agent)}</h3>
            <div className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1">
              <CheckCheck className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground text-xs uppercase">
                {"Verified"}
              </span>
            </div>
          </div>
        </div>
        <div className="text-muted-foreground text-5xl font-light">
          {getAgentDescription(agent)}
        </div>

        <div className="flex items-center justify-between gap-4 pt-8">
          <div className="text-base">
            <span className="font-medium">
              {t("pricing", {
                credits: convertCentsToCredits(creditsPrice.cents),
              })}
            </span>
          </div>
          <div className="flex gap-2">
            <Link href={`/agents/${agent.id}`}>
              <Button size="lg" variant="secondary">
                {t("view")}
              </Button>
            </Link>
            <FeaturedAgentHireButton agentId={agent.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
