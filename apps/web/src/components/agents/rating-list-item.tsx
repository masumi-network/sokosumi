"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { StarRating } from "@/components/agents/star-rating";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { UserAgentRatingWithUser } from "@/lib/db/repositories/agentRating.repository";

const COMMENT_TRUNCATE_LENGTH = 60;

interface RatingListItemProps {
  rating: UserAgentRatingWithUser;
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
    <div className="border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <Avatar className="size-10">
          <AvatarImage src={rating.user.image ?? undefined} />
          <AvatarFallback>{userInitials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">{rating.user.name}</span>
            <span className="text-muted-foreground text-xs">
              {formatDistanceToNow(rating.createdAt, { addSuffix: true })}
            </span>
          </div>
          <StarRating averageRating={rating.rating} size="sm" />
          {rating.comment && (
            <div className="mt-2">
              <p
                className="text-sm"
                style={{
                  wordBreak: "break-all",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                }}
              >
                {displayComment}
              </p>
              {shouldTruncate && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-auto p-0 text-xs"
                >
                  {isExpanded ? t("showLess") : t("readMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
