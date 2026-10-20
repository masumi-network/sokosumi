import { type Prisma, SocialPostStatus } from "@sokosumi/database";

import { RUN_HORIZON_MS } from "@/services/task-schedule-runs.service";

export function scheduledSocialPostWhere(
  workspaceId: string,
  userId: string,
  scope: "owned" | "workspace",
  projectId?: string,
): Prisma.SocialPostWhereInput {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(scope === "owned" ? { scheduledByUserId: userId } : {}),
    status: {
      in: [SocialPostStatus.SCHEDULED, SocialPostStatus.PUBLISHING],
    },
    scheduledAt: { not: null },
  };
}

export function getCalendarBrowseEnd(
  now: Date,
  latestScheduledAt: Date | null,
): Date {
  const defaultEnd = new Date(now.getTime() + RUN_HORIZON_MS);
  if (!latestScheduledAt) return defaultEnd;

  // UTC+14 may place a post in the next month; allow its complete padded
  // Sunday-based month grid, including clients as far west as UTC-12.
  const latestLocalDate = new Date(
    latestScheduledAt.getTime() + 14 * 60 * 60 * 1000,
  );
  const monthEnd = new Date(
    Date.UTC(
      latestLocalDate.getUTCFullYear(),
      latestLocalDate.getUTCMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ),
  );
  const gridEnd = new Date(
    monthEnd.getTime() +
      (6 - monthEnd.getUTCDay() + 2) * 24 * 60 * 60 * 1000 +
      12 * 60 * 60 * 1000,
  );
  return gridEnd > defaultEnd ? gridEnd : defaultEnd;
}
