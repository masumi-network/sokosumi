import { cva, VariantProps } from "class-variance-authority";
import Image from "next/image";
import { useTranslations } from "next-intl";

import ClickBlocker from "@/components/click-blocker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithCreditsPrice,
  AgentWithRelations,
  convertCentsToCredits,
  getAgentName,
  getAgentResolvedImage,
  getAgentTags,
  getShortAgentAuthorName,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import {
  AgentBadgeCloud,
  AgentBadgeCloudSkeleton,
  AgentNewBadge,
} from "./agent-badge-cloud";
import { AgentBookmarkButton } from "./agent-bookmark-button";
import { AgentDetailLink } from "./agent-detail-link";
import { AgentHireButton } from "./agent-hire-button";
import { AgentVerifiedBadge } from "./agent-verified-badge";

const agentCardVariants = cva("flex rounded-lg border-none p-1 shadow-none", {
  variants: {
    size: {
      xs: "hover:bg-foreground/5 w-64 flex-row items-center gap-2.5 transition-colors",
      sm: "hover:bg-foreground/5 w-80 flex-row items-center gap-4 transition-colors",
      md: "w-[min(100%,theme(maxWidth.5xl))] flex-col items-center gap-6 md:hover:bg-foreground/5 md:w-80 md:gap-2 md:transition-colors",
      lg: "w-[min(100%,theme(maxWidth.5xl))] flex-col items-center gap-6 md:flex-row md:gap-2",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardImageContainerVariants = cva(
  "group relative shrink-0 overflow-hidden rounded-lg",
  {
    variants: {
      size: {
        xs: "agent-card-image-shadow h-16 w-16",
        sm: "agent-card-image-shadow h-24 w-24",
        md: "md:agent-card-image-shadow aspect-[1.6] w-full",
        lg: "aspect-[1.6] w-full md:w-1/2",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardImageHoverVariants = cva(
  "absolute inset-0 z-30 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100",
  {
    variants: {
      size: {
        xs: "hidden",
        sm: "hidden",
        md: "flex md:backdrop-blur-md",
        lg: "hidden",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardBadgesContainerVariants = cva(
  "absolute inset-0 z-20 flex-col justify-between gap-4 p-3",
  {
    variants: {
      size: {
        xs: "hidden",
        sm: "hidden",
        md: "flex transition-opacity group-hover:opacity-0",
        lg: "flex",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardContentVariants = cva("flex w-full flex-col", {
  variants: {
    size: {
      xs: "min-w-0 flex-1 gap-1",
      sm: "min-w-0 flex-1 gap-2",
      md: "flex-1 gap-8 p-0 md:gap-2 md:p-1",
      lg: "flex-1 gap-8 p-0 md:max-w-1/2 md:gap-12 md:p-12",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardNameVariants = cva("text-foreground truncate font-medium", {
  variants: {
    size: {
      xs: "text-xs leading-4",
      sm: "text-sm leading-4",
      md: "text-base leading-6",
      lg: "text-2xl leading-8 md:text-3xl",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardAuthorVariants = cva("text-muted-foreground truncate", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      md: "text-base",
      lg: "text-2xl md:text-3xl",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardPricingAndButtonsContainerVariants = cva(
  "flex flex-col justify-start gap-4 lg:flex-row lg:justify-between lg:gap-0",
  {
    variants: {
      size: {
        xs: "flex-col",
        sm: "flex-col",
        md: "flex-col",
        lg: "flex-col items-center justify-between md:flex-row md:items-start",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardButtonsContainerVariants = cva(
  "flex w-full items-center gap-1.5 md:w-auto",
  {
    variants: {
      size: {
        xs: "block",
        sm: "block",
        md: "block md:hidden",
        lg: "w-full md:w-auto",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const agentCardPricingVariants = cva("font-medium", {
  variants: {
    size: {
      xs: "hidden",
      sm: "hidden",
      md: "w-full text-sm",
      lg: "w-auto text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentShowDetailButtonVariants = cva("", {
  variants: {
    size: {
      xs: "block",
      sm: "block",
      md: "hidden",
      lg: "hidden md:block",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentHireButtonVariants = cva("w-full md:w-auto", {
  variants: {
    size: {
      xs: "hidden",
      sm: "hidden",
      md: "block md:hidden",
      lg: "block",
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
  const isDefault = !size || size === "md";

  return (
    <Card className={cn(agentCardVariants({ size }), className)}>
      {/* Image */}
      <div className={cn(agentCardImageContainerVariants({ size }))}>
        <Skeleton className="h-full w-full" />

        {/* Badges */}
        <div className={cn(agentCardBadgesContainerVariants({ size }))}>
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

        {/* Pricing and Buttons */}
        <div
          className={cn(agentCardPricingAndButtonsContainerVariants({ size }))}
        >
          {/* Pricing */}
          <div className={cn(agentCardPricingVariants({ size }))}>
            <Skeleton className="h-4 w-16" />
          </div>
          {/* Buttons */}
          <div className={cn(agentCardButtonsContainerVariants({ size }))}>
            {!isDefault && (
              <div className={cn(agentShowDetailButtonVariants({ size }))}>
                <Skeleton className="h-4 w-16" />
              </div>
            )}
            <div className={cn(agentHireButtonVariants({ size }))}>
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface AgentCardProps {
  agent: AgentWithCreditsPrice;
  favoriteAgents?: AgentWithRelations[] | undefined;
  className?: string | undefined;
}

function AgentCard({
  agent,
  favoriteAgents,
  className,
  size,
}: AgentCardProps & VariantProps<typeof agentCardVariants>) {
  const t = useTranslations("Components.Agents.AgentCard");
  const isFavorite = favoriteAgents?.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  const isDefault = !size || size === "md";
  const buttonSize = size === "xs" || size === "sm" ? "sm" : "lg";

  return (
    <>
      <AgentCardWrapper agentId={agent.id} isLink={isDefault}>
        <Card className={cn(agentCardVariants({ size }), className)}>
          {/* Image */}
          <div className={cn(agentCardImageContainerVariants({ size }))}>
            <AgentCardWrapper agentId={agent.id} isLink={size === "lg"}>
              <Image
                src={getAgentResolvedImage(agent)}
                alt={`${getAgentName(agent)} image`}
                width={400}
                height={250}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </AgentCardWrapper>

            {/* Hover blur and Show Details Button */}
            <div className={cn(agentCardImageHoverVariants({ size }))}>
              <div className="relative flex h-full w-full items-center justify-center">
                {favoriteAgents && (
                  <ClickBlocker className="absolute top-3 right-3">
                    <AgentBookmarkButton
                      agentId={agent.id}
                      isFavorite={isFavorite ?? false}
                    />
                  </ClickBlocker>
                )}
                <Button className="hidden md:block" variant="primary">
                  {t("view")}
                </Button>
              </div>
            </div>

            {/* Badges */}
            <div className={cn(agentCardBadgesContainerVariants({ size }))}>
              {/* New Badge */}
              {agent.isNew && <AgentNewBadge />}
              {/* Tags */}
              <AgentBadgeCloud tags={getAgentTags(agent)} />
            </div>
          </div>

          {/* Content */}
          <div className={cn(agentCardContentVariants({ size }))}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className={agentCardNameVariants({ size })}>
                  {getAgentName(agent)}
                </h3>
                <AgentVerifiedBadge />
              </div>
              <p className={agentCardAuthorVariants({ size })}>
                {getShortAgentAuthorName(agent)}
              </p>
            </div>

            {/* Pricing and Buttons */}
            <div
              className={cn(
                agentCardPricingAndButtonsContainerVariants({ size }),
              )}
            >
              {/* Pricing */}
              <div className={cn(agentCardPricingVariants({ size }))}>
                <p>
                  {t("pricing", {
                    price: convertCentsToCredits(agent.creditsPrice.cents),
                  })}
                </p>
              </div>
              {/* Buttons */}
              <div className={cn(agentCardButtonsContainerVariants({ size }))}>
                {!isDefault && (
                  <div className={cn(agentShowDetailButtonVariants({ size }))}>
                    <Button variant="secondary" size={buttonSize} asChild>
                      <AgentDetailLink agentId={agent.id}>
                        {t("view")}
                      </AgentDetailLink>
                    </Button>
                  </div>
                )}
                <div className={cn(agentHireButtonVariants({ size }))}>
                  <Button
                    variant="primary"
                    size={buttonSize}
                    className="w-full cursor-pointer md:w-auto"
                  >
                    {t("view")}
                  </Button>
                </div>
                <ClickBlocker
                  className={cn(agentHireButtonVariants({ size }), "hidden")}
                >
                  <AgentHireButton
                    agentId={agent.id}
                    className="w-full md:w-auto"
                  />
                </ClickBlocker>
              </div>
            </div>
          </div>
        </Card>
      </AgentCardWrapper>
    </>
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
