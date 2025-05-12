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
  getAgentTags,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import { AgentBadgeCloud, AgentBadgeCloudSkeleton } from "./agent-badge-cloud";
import { AgentBookmarkButton } from "./agent-bookmark-button";
import { AgentDetailLink } from "./agent-detail-link";
import { AgentHireButton } from "./agent-hire-button";
import { AgentVerifiedBadge } from "./agent-verified-badge";

const agentCardVariants = cva("flex rounded-lg border-none p-1 shadow-none", {
  variants: {
    size: {
      xs: "w-64 flex-row items-center gap-2.5 hover:bg-foreground/5 transition-colors",
      sm: "w-80 flex-row items-center gap-4 hover:bg-foreground/5 transition-colors",
      md: "w-80 flex-col gap-2 hover:bg-foreground/5 transition-colors",
      lg: "w-6xl flex-row items-center gap-2",
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
        xs: "w-16 h-16 aspect-square",
        sm: "w-24 h-24 aspect-square",
        md: "w-full aspect-[1.6]",
        lg: "w-xl aspect-[1.6]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardTagsVariants = cva("absolute top-3 left-3 z-20", {
  variants: {
    size: {
      xs: "hidden",
      sm: "hidden",
      md: "block",
      lg: "block",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardImageHoverVariants = cva(
  "absolute inset-0 z-20 opacity-0 transition-opacity group-hover:opacity-100",
  {
    variants: {
      size: {
        xs: "hidden",
        sm: "hidden",
        md: "block backdrop-blur-md",
        lg: "hidden",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardContentVariants = cva("flex flex-col", {
  variants: {
    size: {
      xs: "flex-1 gap-1 min-w-0 [&_h3]:font-medium [&_h3]:text-xs [&_p]:text-xs",
      sm: "flex-1 gap-2 min-w-0 [&_h3]:font-medium [&_h3]:text-sm [&_p]:text-sm",
      md: "flex-1 gap-2 p-1 [&_h3]:font-medium [&_h3]:text-base [&_p]:text-base",
      lg: "flex-1 p-12 max-w-1/2 gap-12 [&>div]:gap-2 [&_h3]:font-light [&_h3]:text-3xl [&_p]:text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardViewButtonContainerVariants = cva("", {
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

const agentCardPricingAndButtonsContentVariants = cva(
  "flex flex-row items-center justify-between mt-auto",
  {
    variants: {
      size: {
        xs: "hidden",
        sm: "hidden",
        md: "[&>div:nth-child(2)]:hidden [&>div>p]:font-medium [&>div>p]:text-sm",
        lg: "[&>div>p]:font-medium [&>div>p]:text-base",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

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

        {/* Tags */}
        <div className={cn(agentCardTagsVariants({ size }))}>
          <AgentBadgeCloudSkeleton />
        </div>
      </div>

      {/* Content */}
      <div className={cn(agentCardContentVariants({ size }))}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12 rounded-lg" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
        {/* View Button */}
        <div className={cn(agentCardViewButtonContainerVariants({ size }))}>
          <Skeleton className="h-6 w-18" />
        </div>
        {/* Pricing and Buttons */}
        <div
          className={cn(agentCardPricingAndButtonsContentVariants({ size }))}
        >
          <div>
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-6 w-18" />
            <Skeleton className="h-6 w-18" />
          </div>
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
  size,
}: AgentCardProps & VariantProps<typeof agentCardVariants>) {
  const t = useTranslations("Components.Agents.AgentCard");

  const isLink = !size || size === "md";

  return (
    <AgentCardWrapper agentId={agent.id} isLink={isLink}>
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

          {/* Tags */}
          <div className={cn(agentCardTagsVariants({ size }))}>
            <AgentBadgeCloud tags={getAgentTags(agent)} />
          </div>
        </div>

        {/* Content */}
        <div className={cn(agentCardContentVariants({ size }))}>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="text-foreground truncate text-base leading-9 font-medium">
                {getAgentName(agent)}
              </h3>
              <AgentVerifiedBadge />
            </div>
            <p className="text-muted-foreground truncate text-sm">
              {getAgentAuthorName(agent)}
            </p>
          </div>
          {/* View Button */}
          <div className={cn(agentCardViewButtonContainerVariants({ size }))}>
            {!isLink && (
              <Button variant="secondary" size="sm" asChild>
                <AgentDetailLink agentId={agent.id} className="text-xs">
                  {t("view")}
                </AgentDetailLink>
              </Button>
            )}
          </div>
          {/* Pricing and Buttons */}
          <div
            className={cn(agentCardPricingAndButtonsContentVariants({ size }))}
          >
            <div>
              <p>
                {t("pricing", {
                  price: convertCentsToCredits(agentCreditsPrice.cents),
                })}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {!isLink && (
                <Button variant="secondary" size="lg" asChild>
                  <AgentDetailLink agentId={agent.id}>
                    {t("view")}
                  </AgentDetailLink>
                </Button>
              )}
              <AgentHireButton agentId={agent.id} />
            </div>
          </div>
        </div>
      </Card>
    </AgentCardWrapper>
  );
}

function AgentCardWrapper({
  isLink,
  agentId,
  children,
}: {
  isLink: boolean;
  agentId: string;
  children: React.ReactNode;
} & VariantProps<typeof agentCardVariants>) {
  if (isLink) {
    return <AgentDetailLink agentId={agentId}>{children}</AgentDetailLink>;
  }

  return children;
}

export { AgentCard, AgentCardSkeleton };
