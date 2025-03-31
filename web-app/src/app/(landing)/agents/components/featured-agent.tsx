import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BadgeCloud } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { LandingRoute } from "@/types/routes";

export function FeaturedAgentSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Text Content Section - 1/3 width */}
      <div className="w-full space-y-6 md:w-1/3">
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

      {/* Image Section - 2/3 width */}
      <div className="relative aspect-16/9 w-full overflow-hidden rounded-lg md:w-2/3">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

interface FeaturedAgentProps {
  agent: AgentDTO;
}

export function FeaturedAgent({ agent }: FeaturedAgentProps) {
  const t = useTranslations("Landing.Agents.FeaturedAgent");
  const { id, name, description, tags, image } = agent;

  return (
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Text Content Section - 1/3 width */}
      <div className="w-full space-y-6 md:w-1/3">
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <div className="space-y-4">
          <h3 className="text-4xl font-bold tracking-tight">{name}</h3>
        </div>
        <p className="text-muted-foreground text-lg">{description}</p>
        <BadgeCloud tags={tags} />
        <Link href={`${LandingRoute.Agents}/${id}`}>
          <Button size="lg" className="w-full md:w-auto">
            {t("button")}
          </Button>
        </Link>
      </div>

      {/* Image Section - 2/3 width */}
      <div className="relative aspect-16/9 w-full md:w-2/3">
        <Image
          src={image}
          alt={`${name} image`}
          fill
          className="rounded-lg object-cover"
          priority
        />
      </div>
    </div>
  );
}
