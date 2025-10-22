"use client";

import { useTranslations } from "next-intl";

import { StarIcon } from "@/components/agents/star-icon";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  averageRating: number;
  totalRatings?: number; // If provided, shows full display; if not, shows only stars
  showRatingNumber?: boolean; // If false, hides the rating number (e.g., "3.7")
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StarRating({
  averageRating,
  totalRatings,
  showRatingNumber = true,
  size = "md",
  className,
}: StarRatingProps) {
  const t = useTranslations("Components.Agents.Rating");

  const textSizeClasses = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  // Handle no ratings case
  if (totalRatings === 0) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex items-center gap-1",
          textSizeClasses[size],
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

  // If totalRatings is not provided, show only stars
  if (totalRatings === undefined) {
    return (
      <div className={cn("flex items-center gap-0.5", className)}>
        {starFills.map((fillPercentage, index) => (
          <StarIcon key={index} fillPercentage={fillPercentage} size={size} />
        ))}
      </div>
    );
  }

  // Full rating display with text and count
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Rating number - only show if showRatingNumber is true */}
      {showRatingNumber && (
        <span className={cn("font-medium", textSizeClasses[size])}>
          {averageRating.toFixed(1)}
        </span>
      )}

      {/* Stars */}
      <div className="flex items-center gap-0.5">
        {starFills.map((fillPercentage, index) => (
          <StarIcon key={index} fillPercentage={fillPercentage} size={size} />
        ))}
      </div>

      {/* Total count */}
      <span className={cn("text-muted-foreground", textSizeClasses[size])}>
        {"("}
        {totalRatings}
        {")"}
      </span>
    </div>
  );
}
