import { Star } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { cn } from "@/lib/utils";

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
        <div className="flex items-center gap-4">
          <div className="bg-muted h-10 w-24 animate-pulse rounded" />
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
        </div>
      </CardFooter>
    </Card>
  );
}

interface AgentCardProps {
  agent: AgentDTO;
  className?: string | undefined;
}

function AgentCard({ agent, className }: AgentCardProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  const { id, name, description, image, tags, averageStars, credits } = agent;

  return (
    <Card
      className={cn(
        "flex w-72 flex-col overflow-hidden py-0 sm:w-96",
        className,
      )}
    >
      <div className="relative h-48 w-full shrink-0">
        <Image
          src={image ?? "/placeholder.svg"}
          alt={`${name} image`}
          fill
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

        <h3 className="mb-2 shrink-0 text-xl font-bold">{name}</h3>
        <p className="text-muted-foreground mb-3 line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal">
          {description}
        </p>
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap overflow-hidden">
          <BadgeCloud tags={tags} />
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex items-center gap-4">
          <AgentCardButton agentId={id} />

          <div>
            <p className="text-muted-foreground text-s">
              {t("pricing", { price: credits })}
            </p>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

export { AgentCard, AgentCardSkeleton };
