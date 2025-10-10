"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface AgentRatingDisplayProps {
  averageRating: number;
  totalRatings: number;
  roundedRating: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function AgentRatingDisplay({
  averageRating,
  totalRatings,
  roundedRating,
  size = "md",
  className,
}: AgentRatingDisplayProps) {
  const t = useTranslations("Components.Agents.Rating");

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const starSizeClasses = {
    sm: "size-3",
    md: "size-4",
    lg: "size-5",
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

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Stars */}
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={cn(
              "fill-current",
              index < roundedRating
                ? "text-yellow-400"
                : "text-muted-foreground",
              starSizeClasses[size],
            )}
          />
        ))}
      </div>

      {/* Rating text */}
      <span className={cn("text-muted-foreground", sizeClasses[size])}>
        {t("averageRating", { average: averageRating.toFixed(1) })}
      </span>

      {/* Total count */}
      <span className={cn("text-muted-foreground", sizeClasses[size])}>
        {t("totalRatings", { count: totalRatings })}
      </span>
    </div>
  );
}
