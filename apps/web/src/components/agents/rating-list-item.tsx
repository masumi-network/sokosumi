"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { StarRating } from "@/components/agents/star-rating";
import { TimeAgo } from "@/components/time-ago";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { AgentReview } from "@/lib/clients/generated/core";

const COMMENT_TRUNCATE_LENGTH = 60;

interface RatingListItemProps {
  rating: AgentReview;
}

export function RatingListItem({ rating }: RatingListItemProps) {
  const t = useTranslations("Components.Agents.Reviews");
  const [isExpanded, setIsExpanded] = useState(false);

  const userInitials = rating.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const shouldTruncate =
    rating.comment && rating.comment.length > COMMENT_TRUNCATE_LENGTH;
  const displayComment =
    rating.comment && !isExpanded && shouldTruncate
      ? rating.comment.slice(0, COMMENT_TRUNCATE_LENGTH) + "..."
      : rating.comment;

  return (
    <div className="bg-muted/20 border-border/50 rounded-lg border px-3 py-3">
      <div className="flex items-start gap-4">
        <Avatar className="size-6 shrink-0 self-start">
          <AvatarImage src={rating.user.image ?? undefined} />
          <AvatarFallback className="bg-muted text-[10px]">
            {userInitials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{rating.user.name}</span>
            <TimeAgo
              date={rating.createdAt}
              className="text-muted-foreground/40 text-xs whitespace-nowrap"
            />
          </div>
          <div className="mt-1">
            <StarRating averageRating={rating.rating} size="sm" />
          </div>
          {rating.comment ? (
            <div className="mt-2">
              <p
                className="text-foreground/70 text-sm"
                style={{
                  wordBreak: "break-all",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                }}
              >
                {displayComment}
              </p>
              {shouldTruncate ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-auto p-0 text-xs"
                >
                  {isExpanded ? t("showLess") : t("readMore")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
