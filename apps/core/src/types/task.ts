import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import {
  jobSummaryUserOrganizationInclude,
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import {
  type AuthenticationContext,
  isUserAuthContext,
} from "@/middleware/auth";
import {
  buildVisibleTaskLinksInclude,
  taskLinksInclude,
} from "@/types/task-link";

export const taskEventApiInclude = {
  user: { select: { id: true, name: true, image: true } },
  coworker: { select: { id: true, name: true, image: true, slug: true } },
  transaction: { select: { amount: true } },
} as const;

const taskUserOrganizationInclude = {
  user: taskEventApiInclude.user,
  organization: { select: { id: true, name: true, slug: true } },
  coworker: taskEventApiInclude.coworker,
  createdByCoworker: taskEventApiInclude.coworker,
} as const;

// Held comments (heldByGrantId set) are visible ONLY to the task owner.
// Every include that loads events must filter them; the owner exception is
// granted exclusively through buildTaskIncludeForViewer below, so a new
// route reusing these includes is leak-safe by default.
const taskBaseInclude = {
  ...workspaceRelationInclude,
  ...taskUserOrganizationInclude,
  events: {
    where: { heldByGrantId: null },
    include: taskEventApiInclude,
    orderBy: {
      createdAt: "asc" as const,
    },
  },
  jobs: {
    include: {
      ...workspaceRelationInclude,
      ...jobWithEvents,
      ...jobWithTransaction,
      ...jobWithPurchase,
      ...jobSummaryUserOrganizationInclude,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export const taskListInclude = taskBaseInclude;

export const taskInclude = {
  ...taskBaseInclude,
  share: true,
  ...taskLinksInclude,
} as const;

export function buildTaskIncludeForViewer(
  authContext: AuthenticationContext,
  workspaceId?: string | null,
) {
  return {
    ...taskBaseInclude,
    // Session users additionally see events held on tasks THEY own — the
    // relation filter proves ownership row-by-row, so a colleague reading
    // the same task still gets held comments stripped.
    events: {
      ...taskBaseInclude.events,
      where: isUserAuthContext(authContext)
        ? {
            OR: [
              { heldByGrantId: null },
              { task: { userId: authContext.userId } },
            ],
          }
        : { heldByGrantId: null },
    },
    share: true,
    ...buildVisibleTaskLinksInclude(authContext, workspaceId),
  } satisfies Prisma.TaskInclude;
}

export type TaskListItemWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
