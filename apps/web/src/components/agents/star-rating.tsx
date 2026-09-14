"use client";

import { StarIcon } from "@/components/agents/star-icon";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  averageRating: number;
  totalRatings?: number; // If provided, shows full display; if not, shows only stars
  showRatingNumber?: boolean; // If false, hides the rating number (e.g., "3.7")
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export function StarRating({
  averageRating,
  totalRatings,
  showRatingNumber = true,
  size = "md",
  className,
}: StarRatingProps) {
  const textSizeClasses = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  const gapClasses = {
    xs: "gap-0.5",
    sm: "gap-0.5",
    md: "gap-1",
    lg: "gap-1",
  };

  const fullStars = Math.floor(averageRating);
  const partialFillPercent = (averageRating % 1) * 100;
  const hasPartialStar = partialFillPercent > 0;
  const emptyStars = 5 - fullStars - (hasPartialStar ? 1 : 0);

  const starFills: number[] = [];

  for (let i = 0; i < fullStars; i++) {
    starFills.push(100);
  }

  if (hasPartialStar) {
    starFills.push(partialFillPercent);
  }

  for (let i = 0; i < emptyStars; i++) {
    starFills.push(0);
  }

  if (totalRatings === undefined) {
    return (
      <div className={cn("flex items-center", gapClasses[size], className)}>
        {starFills.map((fillPercentage, index) => (
          <StarIcon key={index} fillPercentage={fillPercentage} size={size} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {showRatingNumber && (
        <span className={cn("font-medium", textSizeClasses[size])}>
          {averageRating.toFixed(1)}
        </span>
      )}

      <div className={cn("flex items-center", gapClasses[size])}>
        {starFills.map((fillPercentage, index) => (
          <StarIcon key={index} fillPercentage={fillPercentage} size={size} />
        ))}
      </div>

      <span className={cn("text-muted-foreground", textSizeClasses[size])}>
        {"("}
        {totalRatings}
        {")"}
      </span>
    </div>
  );
}
