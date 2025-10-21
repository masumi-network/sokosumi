"use client";

import { useTranslations } from "next-intl";

import { StarRating } from "@/components/agents/star-rating";
import { cn } from "@/lib/utils";

interface AgentRatingDisplayProps {
  averageRating: number;
  totalRatings: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function AgentRatingDisplay({
  averageRating,
  totalRatings,
  size = "md",
  className,
}: AgentRatingDisplayProps) {
  const t = useTranslations("Components.Agents.Rating");

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  if (totalRatings === 0) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex items-center gap-1",
          sizeClasses[size],
          className,
        )}
      >
        <span>{t("noRatings")}</span>
      </div>
    );
  }

  // Calculate star fills based on average rating
  const fullStars = Math.floor(averageRating);
  const partialFillPercent = (averageRating % 1) * 100;
  const hasPartialStar = partialFillPercent > 0;
  const emptyStars = 5 - fullStars - (hasPartialStar ? 1 : 0);

  // Create array of star fill percentages
  const starFills: number[] = [];

  // Add full stars
  for (let i = 0; i < fullStars; i++) {
    starFills.push(100);
  }

  // Add partial star if needed
  if (hasPartialStar) {
    starFills.push(partialFillPercent);
  }

  // Add empty stars
  for (let i = 0; i < emptyStars; i++) {
    starFills.push(0);
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Rating number */}
      <span className={cn("font-medium", sizeClasses[size])}>
        {averageRating.toFixed(1)}
      </span>

      {/* Stars */}
      <div className="flex items-center gap-0.5">
        {starFills.map((fillPercentage, index) => (
          <StarRating key={index} fillPercentage={fillPercentage} size={size} />
        ))}
      </div>

      {/* Total count */}
      <span className={cn("text-muted-foreground", sizeClasses[size])}>
        {"("}
        {totalRatings}
        {")"}
      </span>
    </div>
  );
}
