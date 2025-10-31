import type { AgentRatingStats } from "@sokosumi/database";
import { CircleCheck, Clock, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { StarRating } from "@/components/agents/star-rating";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/utils";

function AgentDetailStats({
  executedJobsCount,
  averageExecutionDuration,
  ratingStats,
}: {
  executedJobsCount: number;
  averageExecutionDuration: number;
  ratingStats?: AgentRatingStats;
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Stats");
  const formatter = useFormatter();
  const tDuration = useTranslations("Library.Duration.Long");

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);

  const hasRating = ratingStats && ratingStats.totalRatings > 0;
  const gridCols = hasRating
    ? averageExecutionDuration > 0
      ? "grid-cols-3"
      : "grid-cols-2"
    : "grid-cols-2";

  return (
    <div className={`grid gap-4 ${gridCols}`}>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <CircleCheck size={16} />
          <span className="text-upper text-xs">{t("executedJobs")}</span>
        </div>
        <p className="text-base">
          {formatter.number(executedJobsCount, {
            notation: "compact",
          })}
        </p>
      </div>
      {averageExecutionDuration > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Clock size={16} />
            <span className="text-upper text-xs">
              {t("averageExecutionTime")}
            </span>
          </div>
          <p className="text-base">{formattedDuration}</p>
        </div>
      )}
      {hasRating && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Star size={16} />
            <span className="text-upper text-xs">{t("rating")}</span>
          </div>
          <div className="flex items-center gap-1">
            <StarRating
              averageRating={ratingStats.averageRating}
              totalRatings={ratingStats.totalRatings}
              showRatingNumber={true}
              size="md"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentDetailStatsSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-6 w-24" />
    </div>
  );
}

export { AgentDetailStats, AgentDetailStatsSkeleton };
