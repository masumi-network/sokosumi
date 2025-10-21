import { getTranslations } from "next-intl/server";

import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { StarRating } from "@/components/agents/star-rating";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/utils";
import { AgentRatingStats } from "@/lib/db/repositories/agentRating.repository";
import { agentService } from "@/lib/services";

interface AgentDetailRatingSectionProps {
  agentId: string;
  ratingStats: AgentRatingStats;
}

export async function AgentDetailRatingSection({
  agentId,
  ratingStats,
}: AgentDetailRatingSectionProps) {
  const t = await getTranslations("Components.Agents.Rating");
  const authContext = await getAuthContext();

  // Check if user can rate this agent
  const canRate = authContext?.userId
    ? await agentService.canUserRateAgent(authContext.userId, agentId)
    : false;

  // Get user's existing rating if they can rate
  const existingRating =
    authContext?.userId && canRate
      ? await agentService.getUserRatingForAgent(authContext.userId, agentId)
      : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("title")}</h3>
        <StarRating
          averageRating={ratingStats.averageRating}
          totalRatings={ratingStats.totalRatings}
          size="lg"
          className="mt-2"
        />
      </div>

      {canRate && (
        <div>
          <h4 className="mb-3 text-sm font-medium">
            {existingRating ? t("updateRating") : t("submitRating")}
          </h4>
          <AgentRatingForm
            agentId={agentId}
            existingRating={existingRating?.rating ?? null}
            existingComment={existingRating?.comment ?? null}
          />
        </div>
      )}

      {!canRate && authContext?.userId && (
        <p className="text-muted-foreground text-sm">
          {t("eligibilityMessage")}
        </p>
      )}
    </div>
  );
}

export function AgentDetailRatingSectionSkeleton() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-6 w-20" />
        <div className="mt-2 flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
