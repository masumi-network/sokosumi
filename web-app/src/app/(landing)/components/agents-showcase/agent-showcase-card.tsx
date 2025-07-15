import Image from "next/image";
import { useTranslations } from "next-intl";

import { AgentDetailLink } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agentId: string;
  name: string;
  description: string | null;
  image?: string;
  isExpanded?: boolean;
}

export default function AgentShowcaseCard({
  agentId,
  name,
  description,
  image,
  isExpanded = false,
}: AgentCardProps) {
  const t = useTranslations("Landing.Page.Hero.AgentsShowcase");

  return (
    <div
      className={cn(
        "bg-background/20 group flex h-[90px] w-[300px] items-center overflow-hidden rounded-lg shadow-md transition-all duration-300 hover:w-[300px]",
        !isExpanded && "md:w-[90px]",
      )}
    >
      <div className="relative h-[90px] w-[90px] shrink-0">
        <Image
          src={image ?? "/images/placeholder.svg"}
          alt={name}
          className="object-cover"
          fill
          sizes="90px"
        />
      </div>
      <div className="w-[210px] px-3 opacity-100 transition-opacity duration-300 group-hover:opacity-100">
        <h3 className="mb-1 truncate text-sm font-bold">{name}</h3>
        {description && (
          <p className="text-foreground mb-2 w-full truncate text-xs">
            {description}
          </p>
        )}
        <Button variant="secondary" size="sm" asChild>
          <AgentDetailLink agentId={agentId}>{t("viewAgent")}</AgentDetailLink>
        </Button>
      </div>
    </div>
  );
}

export function AgentCardSkeleton() {
  return <Skeleton className="h-[90px] w-[300px] rounded-md md:w-[90px]" />;
}
