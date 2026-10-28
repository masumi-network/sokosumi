"use client";

import type { SocialPostStatus } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { cn } from "@/lib/utils";

type FilterStatus = Exclude<SocialPostStatus, "DRAFT">;

/**
 * The period's posts by status, above Social's grid. Each pill is also the
 * Filters menu's status filter: pressing one shows only that status, pressing
 * it again shows them all.
 */
export function SocialStatusSummary({
  counts,
  postCount,
  postStatus,
  statuses,
  onPostStatusChange,
}: {
  /** Per status, the period's posts the other filters leave. */
  counts: ReadonlyMap<FilterStatus, number>;
  /** Posts on the grid now, after every filter. */
  postCount: number;
  postStatus: FilterStatus | null;
  statuses: readonly FilterStatus[];
  onPostStatusChange: (status: FilterStatus | null) => void;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const statusLabel = useTranslations("App.Projects.SocialPosts.status");
  // A pressed pill stays, even at zero, so it can be let go.
  const shown = statuses.filter(
    (status) => counts.has(status) || status === postStatus,
  );

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="calendar-status-summary"
    >
      {shown.length > 0 ? (
        <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
          <legend className="sr-only">{t("statusFilter")}</legend>
          {shown.map((status) => {
            const active = postStatus === status;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  "press border-control-border bg-background hover:bg-muted text-foreground inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border ps-1 pe-2.5 text-xs font-medium outline-none focus-visible:ring-ring-halo focus-visible:ring-2 max-md:min-h-10 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                  active && "border-foreground bg-primary-quinary",
                )}
                data-testid={`calendar-status-pill-${status}`}
                key={status}
                onClick={() => onPostStatusChange(active ? null : status)}
                type="button"
              >
                <span aria-hidden className="flex">
                  <SocialPostStatusBadge
                    className="rounded-full"
                    label={statusLabel(status)}
                    showLabel={false}
                    status={status}
                  />
                </span>
                <span>{statusLabel(status)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {counts.get(status) ?? 0}
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <p
        className="text-muted-foreground text-xs"
        data-testid="calendar-post-count"
      >
        {t("postCount", { count: postCount })}
      </p>
    </div>
  );
}
