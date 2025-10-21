"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { RatingListItem } from "@/components/agents/rating-list-item";
import { Button } from "@/components/ui/button";
import { UserAgentRatingWithUser } from "@/lib/db/repositories/agentRating.repository";

interface ReviewsListProps {
  ratingsWithComments: UserAgentRatingWithUser[];
}

export function ReviewsList({ ratingsWithComments }: ReviewsListProps) {
  const t = useTranslations("Components.Agents.Reviews");
  const [showAllReviews, setShowAllReviews] = useState(false);

  const displayedReviews = showAllReviews
    ? ratingsWithComments
    : ratingsWithComments.slice(0, 5);

  return (
    <div className="space-y-4">
      {displayedReviews.map((rating) => (
        <RatingListItem key={rating.id} rating={rating} />
      ))}
      {ratingsWithComments.length > 5 && (
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => setShowAllReviews(!showAllReviews)}
        >
          {showAllReviews ? t("showLess") : t("viewAllReviews")}
        </Button>
      )}
    </div>
  );
}
