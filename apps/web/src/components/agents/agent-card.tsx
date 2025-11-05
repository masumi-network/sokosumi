import type { AgentRatingStats } from "@sokosumi/database";
import { AgentWithCreditsPrice, AgentWithRelations } from "@sokosumi/database";
import { cva, VariantProps } from "class-variance-authority";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo } from "react";

import ClickBlocker from "@/components/click-blocker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import useIsClient from "@/hooks/use-is-client";
import {
  getAgentAuthorResolvedImage,
  getAgentCategoryStyles,
  getAgentName,
  getAgentSummary,
  getShortAgentAuthorName,
} from "@/lib/helpers/agent";
import { convertCentsToCredits } from "@/lib/helpers/credit";
import { cn, generateGradientBorder } from "@/lib/utils";
import { getCategoryColor } from "@/lib/utils/theme";

import { AgentDetailLink } from "./agent-detail-link";
import { AgentHireButton } from "./agent-hire-button";
import AgentIcon from "./agent-icon";
import AgentSummary from "./agent-summary";
import { AgentVerifiedBadge } from "./agent-verified-badge";
import { StarRating } from "./star-rating";

const agentCardVariants = cva(
  "flex h-full rounded-lg px-4 py-6 shadow-none bg-card-background",
  {
    variants: {
      size: {
        xs: "hover:bg-foreground/5 w-64 flex-row items-center gap-2.5 transition-colors",
        sm: "hover:bg-foreground/5 w-80 flex-row items-center gap-4 transition-colors",
        md: "w-[min(100%,theme(maxWidth.5xl))] flex-col items-start gap-6 md:hover:bg-foreground/5 md:w-80 md:gap-2 md:transition-colors",
        lg: "w-[min(100%,theme(maxWidth.5xl))] flex-col items-start gap-6 md:flex-row md:gap-2",
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
      md: "flex-1 gap-2 p-0",
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

const agentCardSummaryContainerVariants = cva("text-muted-foreground text-sm", {
  variants: {
    size: {
      xs: "hidden",
      sm: "hidden",
      md: "block",
      lg: "hidden",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const agentCardPricingAndButtonsContainerVariants = cva(
  "flex flex-col justify-start gap-4 lg:flex-row lg:justify-between lg:gap-0 bg-card-background",
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
        md: "block",
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

const agentShowDetailsButtonVariants = cva("w-full md:w-auto", {
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

interface AgentCardSkeletonProps {
  className?: string | undefined;
}

function AgentCardSkeleton({
  className,
  size,
}: AgentCardSkeletonProps & VariantProps<typeof agentCardVariants>) {
  return (
    <Card className={cn(agentCardVariants({ size }), className)}>
      {/* Content */}
      <div className={cn(agentCardContentVariants({ size }))}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12 rounded-lg" />
          </div>
          <Skeleton className="h-4 w-16" />
          <div className={agentCardSummaryContainerVariants({ size })}>
            <Skeleton className="h-8 w-full" />
          </div>
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
            <div className={cn(agentShowDetailsButtonVariants({ size }))}>
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
  showHireButton?: boolean | undefined;
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStats?: AgentRatingStats | undefined;
  className?: string | undefined;
}

function AgentCard({
  agent,
  showHireButton = false,
  ratingStats,
  className,
  size,
}: AgentCardProps & VariantProps<typeof agentCardVariants>) {
  const t = useTranslations("Components.Agents.AgentCard");
  const { resolvedTheme } = useTheme();
  const isClient = useIsClient();

  const authorImage = getAgentAuthorResolvedImage(agent);
  const summary = getAgentSummary(agent);
  const isDefault = !size || size === "md";
  const buttonSize = "sm";
  const categoryStyles = getAgentCategoryStyles(agent);

  // Determine the current theme and generate gradient border only on client
  const currentTheme = isClient && resolvedTheme === "dark" ? "dark" : "light";
  const gradientBorder = useMemo(
    () =>
      isClient ? generateGradientBorder(categoryStyles, currentTheme) : null,
    [isClient, categoryStyles, currentTheme],
  );

  // Extract color based on theme-aware logic
  const categoryColor = getCategoryColor(categoryStyles, currentTheme);

  // Generate border style
  const borderStyle =
    isClient && gradientBorder
      ? {
          border: "0.2px solid transparent",
          borderRadius: "0.65rem",
          backgroundImage: gradientBorder
            ? `linear-gradient(var(--card-background), var(--card-background)), ${gradientBorder}`
            : `linear-gradient(var(--card-background), var(--card-background))`,
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
        }
      : undefined;

  const cardContent = (
    <Card
      className={cn(
        agentCardVariants({ size }),
        className,
        "hover-bg-image-transparent",
      )}
      style={borderStyle}
    >
      {/* Header with Icon and Verified Badge */}
      <div className="mb-4 flex min-h-10 w-full items-center justify-between">
        {/* Icon */}
        <div className="shrink-0" style={{ color: categoryColor }}>
          <AgentIcon agent={agent} className="size-8" />
        </div>

        {/* Verified Badge */}
        <AgentVerifiedBadge />
      </div>

      {/* Content */}
      <div className={cn(agentCardContentVariants({ size }))}>
        <div className="flex w-full flex-1 flex-col justify-between gap-3">
          <div className="flex flex-0 flex-col gap-3">
            {/* Title */}
            <h3
              className={agentCardNameVariants({ size })}
              style={{ color: categoryColor }}
            >
              {getAgentName(agent)}
            </h3>

            {/* Rating */}
            <StarRating
              averageRating={ratingStats?.averageRating ?? 0}
              totalRatings={ratingStats?.totalRatings ?? 5}
              size="sm"
              showRatingNumber={false}
            />
          </div>

          {/* Summary/Description */}
          {summary && (
            <div className={agentCardSummaryContainerVariants({ size })}>
              <AgentSummary summary={summary} />
            </div>
          )}

          <div className="flex flex-0 flex-col gap-3">
            {/* Credits */}
            <div className={cn(agentCardPricingVariants({ size }))}>
              <p className="text-foreground">
                {t("pricing", {
                  price: convertCentsToCredits(agent.creditsPrice.cents),
                })}
              </p>
            </div>

            <div className="col-span-2 grid w-full grid-cols-2 items-center gap-2">
              {/* Buttons */}
              <div className={cn(agentCardButtonsContainerVariants({ size }))}>
                {showHireButton ? (
                  <ClickBlocker>
                    <AgentHireButton agentId={agent.id} className="w-full" />
                  </ClickBlocker>
                ) : (
                  <div className={cn(agentShowDetailsButtonVariants({ size }))}>
                    <Button
                      variant="secondary"
                      size={buttonSize}
                      className="w-full cursor-pointer md:w-auto"
                    >
                      {t("view")}
                    </Button>
                  </div>
                )}
              </div>

              {/* Footer Attribution */}
              {authorImage && (
                <div className="flex items-center justify-end">
                  <Image
                    src={authorImage}
                    alt={`${getAgentName(agent)} author`}
                    width={100}
                    height={24}
                    className="h-4 w-auto object-contain brightness-0 dark:brightness-100"
                  />
                </div>
              )}
              {!authorImage && (
                <div className="flex items-center justify-end truncate">
                  <p className="truncate text-xs uppercase">
                    {getShortAgentAuthorName(agent)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <AgentCardWrapper agentId={agent.id} isLink={isDefault}>
      {cardContent}
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
