import "server-only";

import type { CoworkerOption } from "@/lib/types/coworker";

import { listTaskAssigneeMemberOptions } from "./task-assignee-members";
import { listTaskScheduleAssigneeOptions } from "./task-schedule-assignee-options";

/**
 * Everything a Task can be assigned to in a workspace, as picker options:
 * the owner Soko Bot first, then workspace members and coworkers. Core's
 * schedule assignee endpoint supplies the eligible agents for future runs.
 */
export async function listTaskAssigneeOptions(
  organizationId: string | null,
  memberOptions?: CoworkerOption[],
): Promise<CoworkerOption[]> {
  const [members, agentOptions] = await Promise.all([
    memberOptions ?? listTaskAssigneeMemberOptions(organizationId),
    listTaskScheduleAssigneeOptions().catch(() => []),
  ]);

  return [
    ...agentOptions.filter((option) => option.kind === "sokoBot"),
    ...members,
    ...agentOptions.filter((option) => option.kind !== "sokoBot"),
  ];
}
