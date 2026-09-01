"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import useIsClient from "@/hooks/use-is-client";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import {
  getAgentAuthorResolvedImage,
  getAgentCategoryStyles,
  getAgentName,
  getAgentResolvedIcon,
  getShortAgentAuthorName,
} from "@/lib/helpers/agent";
import type { AgentRatingStats } from "@/lib/types/core-dto";
import { cn, generateGradientBorder } from "@/lib/utils";
import { getCategoryColor } from "@/lib/utils/theme";

import { AgentDetailLink } from "./agent-detail-link";
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
        <div className={cn(agentCardButtonsContainerVariants({ size }))}>
          <div className={cn(agentShowDetailsButtonVariants({ size }))}>
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </div>
    </Card>
  );
}

interface AgentCardProps {
  agent: CatalogBrowseAgent;
  ratingStats?: AgentRatingStats | undefined;
  className?: string | undefined;
}

function AgentCard({
  agent,
  ratingStats,
  className,
  size,
}: AgentCardProps & VariantProps<typeof agentCardVariants>) {
  const t = useTranslations("Components.Agents.AgentCard");
  const tKind = useTranslations("Components.Agents.Kind");
  const { resolvedTheme } = useTheme();
  const isClient = useIsClient();

  const authorImage = getAgentAuthorResolvedImage(agent);
  const summary = agent.summary ?? agent.description;
  const isDefault = !size || size === "md";
  const buttonSize = "sm";
  const categoryStyles = getAgentCategoryStyles(agent);

  const currentTheme = isClient && resolvedTheme === "dark" ? "dark" : "light";
  const gradientBorder = useMemo(
    () =>
      isClient ? generateGradientBorder(categoryStyles, currentTheme) : null,
    [isClient, categoryStyles, currentTheme],
  );

  const categoryColor = getCategoryColor(categoryStyles, currentTheme);

  const borderStyle =
    isClient && gradientBorder
      ? {
          border: "0.2px solid transparent",
          borderRadius: "0.65rem",
          backgroundImage: `linear-gradient(var(--card-background), var(--card-background)), ${gradientBorder}`,
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
        }
      : undefined;

  const kindLabel = agent.kind === "x402" ? tKind("x402") : tKind("cardano");
  const linksToDetail = agent.kind === "cardano";

  // Cardano cards wrap the whole card in AgentDetailLink — use a span styled as
  // a button so we do not nest <button> inside <a>.
  const actionButton = linksToDetail ? (
    <div className={cn(agentShowDetailsButtonVariants({ size }))}>
      <span
        className={cn(
          buttonVariants({ variant: "secondary", size: buttonSize }),
          "w-full md:w-auto",
        )}
      >
        {t("view")}
      </span>
    </div>
  ) : agent.externalUrl ? (
    <div className={cn(agentShowDetailsButtonVariants({ size }))}>
      <Button
        variant="secondary"
        size={buttonSize}
        className="w-full cursor-pointer md:w-auto"
        asChild
      >
        <a href={agent.externalUrl} target="_blank" rel="noopener noreferrer">
          {t("view")}
          <ExternalLink className="ml-1.5 size-3.5" />
        </a>
      </Button>
    </div>
  ) : (
    <div className={cn(agentShowDetailsButtonVariants({ size }))}>
      <Button
        variant="secondary"
        size={buttonSize}
        className="w-full md:w-auto"
        disabled
      >
        {t("detailsUnavailable")}
      </Button>
    </div>
  );

  const cardContent = (
    <Card
      className={cn(
        agentCardVariants({ size }),
        className,
        "md:agent-card-roll-up",
      )}
      style={borderStyle}
    >
      <div className="mb-4 flex min-h-10 w-full items-center justify-between">
        <div className="shrink-0" style={{ color: categoryColor }}>
          <AgentIcon
            agent={{
              name: getAgentName(agent),
              icon: getAgentResolvedIcon(agent),
            }}
            className="size-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-medium tracking-wide uppercase">
            {kindLabel}
          </span>
          {linksToDetail ? <AgentVerifiedBadge /> : null}
        </div>
      </div>

      <div className={cn(agentCardContentVariants({ size }))}>
        <div className="flex w-full flex-1 flex-col justify-between gap-3">
          <div className="flex flex-0 flex-col gap-3">
            <h3
              className={agentCardNameVariants({ size })}
              style={{ color: categoryColor }}
            >
              {getAgentName(agent)}
            </h3>

            {linksToDetail ? (
              <StarRating
                averageRating={ratingStats?.average ?? 0}
                totalRatings={ratingStats?.total ?? 0}
                size="sm"
                showRatingNumber={false}
              />
            ) : null}
          </div>

          {summary ? (
            <div className={agentCardSummaryContainerVariants({ size })}>
              <AgentSummary summary={summary} />
            </div>
          ) : null}

          <div className="flex flex-0 flex-col gap-3">
            <div className="col-span-2 grid w-full grid-cols-2 items-center gap-2">
              <div className={cn(agentCardButtonsContainerVariants({ size }))}>
                {actionButton}
              </div>

              {authorImage ? (
                <div className="flex items-center justify-end">
                  <Image
                    src={authorImage}
                    alt={`${getAgentName(agent)} author`}
                    width={100}
                    height={24}
                    className="h-4 w-auto object-contain brightness-0 invert-[0.5] dark:brightness-100"
                  />
                </div>
              ) : (
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

  if (linksToDetail && isDefault) {
    return <AgentDetailLink agentId={agent.id}>{cardContent}</AgentDetailLink>;
  }

  return cardContent;
}

export { AgentCard, AgentCardSkeleton };
