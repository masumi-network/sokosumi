"use client";

import { formatDistanceToNow } from "date-fns";

import { StarRating } from "@/components/agents/star-rating";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserAgentRatingWithUser } from "@/lib/db/repositories/agentRating.repository";

interface RatingListItemProps {
  rating: UserAgentRatingWithUser;
}

export function RatingListItem({ rating }: RatingListItemProps) {
  const userInitials = rating.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <Avatar className="size-10">
          <AvatarImage src={rating.user.image ?? undefined} />
          <AvatarFallback>{userInitials}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">{rating.user.name}</span>
            <span className="text-muted-foreground text-xs">
              {formatDistanceToNow(rating.createdAt, { addSuffix: true })}
            </span>
          </div>
          <StarRating averageRating={rating.rating} size="sm" />
          {rating.comment && <p className="mt-2 text-sm">{rating.comment}</p>}
        </div>
      </div>
    </div>
  );
}
