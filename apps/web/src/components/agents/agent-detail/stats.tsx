import type { AgentRatingStats } from "@sokosumi/utils";
import { CircleCheck, Clock, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { StarRating } from "@/components/agents/star-rating";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration } from "@/lib/utils";

function AgentDetailStats({
  executedJobsCount,
  averageExecutionDuration,
  ratingStats,
}: {
  executedJobsCount: number;
  averageExecutionDuration: number | null;
  ratingStats?: AgentRatingStats;
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Stats");
  const formatter = useFormatter();
  const tDuration = useTranslations("Library.Duration.Long");

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);

  const hasRating = ratingStats && ratingStats.totalRatings > 0;
  const desktopGridCols = hasRating
    ? averageExecutionDuration && averageExecutionDuration > 0
      ? "md:grid-cols-3"
      : "md:grid-cols-2"
    : "md:grid-cols-2";

  return (
    <div className="border-border space-y-4 rounded-lg border px-4 py-4">
      <div className={cn("grid grid-cols-2 gap-4", desktopGridCols)}>
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
        {averageExecutionDuration && averageExecutionDuration > 0 && (
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
          <div className="col-span-2 flex flex-col gap-0.5 md:col-span-1">
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
    </div>
  );
}

function AgentDetailStatsSkeleton() {
  return (
    <div className="border-border space-y-4 rounded-lg border px-4 py-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
    </div>
  );
}

export { AgentDetailStats, AgentDetailStatsSkeleton };
