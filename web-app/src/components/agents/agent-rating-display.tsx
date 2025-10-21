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

  return (
    <StarRating
      averageRating={averageRating}
      totalRatings={totalRatings}
      size={size}
      className={className}
    />
  );
}
