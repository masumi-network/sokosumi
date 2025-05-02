import { cva, VariantProps } from "class-variance-authority";
import Image from "next/image";
import { useTranslations } from "next-intl";

import ClickBlocker from "@/components/click-blocker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentAuthorName,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import { AgentBookmarkButton } from "./agent-bookmark-button";
import { AgentHireButton } from "./agent-hire-button";
import { AgentModalTrigger } from "./agent-modal";
import { AgentVerifiedBadge } from "./agent-verified-badge";

const agentCardVariants = cva("flex rounded-lg border-none p-1 shadow-none", {
  variants: {
    size: {
      xs: "w-64 flex-row items-center gap-2.5",
      sm: "w-80 flex-row items-center gap-4",
      md: "w-80 flex-col gap-2",
      lg: "rounded-md px-6 has-[>svg]:px-4",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardImageContainerVariants = cva(
  "relative group overflow-hidden rounded-lg shrink-0 shadow-foreground/10 shadow-lg",
  {
    variants: {
      size: {
        xs: "w-12 h-12 aspect-square",
        sm: "w-24 h-24 aspect-square",
        md: "w-full aspect-[1.6]",
        lg: "w-full aspect-[1.6]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardImageHoverVariants = cva(
  "absolute inset-0 z-20 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100",
  {
    variants: {
      size: {
        xs: "hidden",
        sm: "hidden",
        md: "block",
        lg: "hidden",
      },
    },
  },
);

const agentCardContentVariants = cva("flex flex-col", {
  variants: {
    size: {
      xs: "flex-1 min-w-0 [&_h3]:font-medium [&_h3]:text-xs [&_p]:text-xs",
      sm: "flex-1 min-w-0 [&_h3]:font-medium [&_h3]:text-sm [&_p]:text-sm",
      md: "flex-1 p-1 [&_h3]:font-medium [&_h3]:text-base [&_p]:text-base",
      lg: "flex-1 p-1 [&_h3]:font-medium [&_h3]:text-base [&_p]:text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardViewButtonContainerVariants = cva("mt-1", {
  variants: {
    size: {
      xs: "block",
      sm: "block",
      md: "hidden",
      lg: "hidden",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardPricingContentVariants = cva("", {
  variants: {
    size: {
      xs: "hidden",
      sm: "hidden",
      md: "px-1 [&_p]:font-medium [&_p]:text-sm",
      lg: "px-1 [&_p]:font-medium [&_p]:text-sm",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

interface AgentCardSkeletonProps {
  className?: string | undefined;
}

function AgentCardSkeleton({
  className,
  size,
}: AgentCardSkeletonProps & VariantProps<typeof agentCardVariants>) {
  return (
    <Card className={cn(agentCardVariants({ size }), className)}>
      {/* Image */}
      <div className={cn(agentCardImageContainerVariants({ size }))}>
        <Skeleton className="h-full w-full" />
      </div>

      {/* Content */}
      <div className={cn(agentCardContentVariants({ size }), "gap-1")}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-12 rounded-lg" />
        </div>
        <Skeleton className="h-4 w-18" />
        <div className={cn(agentCardViewButtonContainerVariants({ size }))}>
          <Skeleton className="h-6 w-24" />
        </div>
      </div>

      {/* Pricing */}
      <div className={cn(agentCardPricingContentVariants({ size }))}>
        <Skeleton className="h-4 w-24" />
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
  size,
}: AgentCardProps & VariantProps<typeof agentCardVariants>) {
  const t = useTranslations("Components.Agents.AgentCard");

  return (
    <AgentModalTrigger agentId={agent.id} className="m-0">
      <Card className={cn(agentCardVariants({ size }), className)}>
        {/* Image */}
        <div className={cn(agentCardImageContainerVariants({ size }))}>
          <Image
            src={getAgentResolvedImage(agent)}
            alt={`${getAgentName(agent)} image`}
            width={400}
            height={250}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />

          {/* Bookmark Button (hover only) */}
          <div className={cn(agentCardImageHoverVariants({ size }))}>
            <div className="relative flex h-full w-full items-center justify-center">
              {agentList && (
                <ClickBlocker className="absolute top-3 right-3">
                  <AgentBookmarkButton
                    agentId={agent.id}
                    agentList={agentList}
                  />
                </ClickBlocker>
              )}
              <ClickBlocker>
                <AgentHireButton agentId={agent.id} />
              </ClickBlocker>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className={cn(agentCardContentVariants({ size }))}>
          <div className="flex items-center gap-2">
            <h3 className="text-primary truncate text-base leading-6 font-medium">
              {getAgentName(agent)}
            </h3>
            <AgentVerifiedBadge />
          </div>
          <p className="text-muted-foreground truncate text-sm">
            {getAgentAuthorName(agent)}
          </p>
          <div className={cn(agentCardViewButtonContainerVariants({ size }))}>
            <AgentModalTrigger agentId={agent.id}>
              <Button variant="outline" className="text-xs" size="sm">
                {t("view")}
              </Button>
            </AgentModalTrigger>
          </div>
        </div>

        {/* Pricing */}
        <div className={cn(agentCardPricingContentVariants({ size }))}>
          <p>
            {t("pricing", {
              price: convertCentsToCredits(agentCreditsPrice.cents),
            })}
          </p>
        </div>
      </Card>
    </AgentModalTrigger>
  );
}

export { AgentCard, AgentCardSkeleton };
