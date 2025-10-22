"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface RatingDistributionProps {
  distribution: Record<number, number>;
  totalRatings: number;
  className?: string;
}

export function RatingDistribution({
  distribution,
  totalRatings,
  className,
}: RatingDistributionProps) {
  const t = useTranslations("Components.Agents.Rating");
  const getPercentage = (count: number) =>
    totalRatings > 0 ? Math.round((count / totalRatings) * 100) : 0;

  return (
    <div className={cn("space-y-2", className)}>
      {[5, 4, 3, 2, 1].map((star) => {
        const count = distribution[star] || 0;
        const percentage = getPercentage(count);

        return (
          <div key={star} className="flex items-center gap-3">
            <span className="w-12 text-sm">{t("star", { count: star })}</span>
            <div className="bg-muted relative h-5 flex-1 overflow-hidden rounded">
              <div
                className="bg-foreground h-full transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className="text-muted-foreground w-12 text-right text-sm">
              {t("percentage", { percentage: percentage })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
