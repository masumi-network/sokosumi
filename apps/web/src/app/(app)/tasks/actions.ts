"use server";

import type { AgentJobStatus, TaskStatus } from "@sokosumi/database";

import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import type { MemberPreviewItem } from "@/app/tasks/utils/member-filter-options";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { userService } from "@/lib/services/user.service";
import type { KanbanColumnId } from "@/lib/types/task";

import { getTasksColumnPage } from "./utils/tasks-column-page";

interface LoadMoreTasksColumnParams {
  columnId: KanbanColumnId;
  cursor: string | null;
  memberId?: string | null;
  coworkerId?: string | null;
  agentId?: string | null;
  taskStatus?: TaskStatus | null;
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  memberId = null,
  coworkerId = null,
  agentId = null,
  taskStatus = null,
}: LoadMoreTasksColumnParams) {
  const [coworkers, agents] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    memberId,
    coworkerId,
    agentId,
    taskStatus,
    coworkersById,
    agentsById,
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

interface LoadMoreJobsParams {
  cursor: string | null;
  memberId?: string | null;
  agentId?: string | null;
  jobStatus?: AgentJobStatus | null;
  memberPreviews?: MemberPreviewItem[];
}

export async function loadMoreJobs({
  cursor,
  memberId = null,
  agentId = null,
  jobStatus = null,
  memberPreviews = [],
}: LoadMoreJobsParams) {
  const [coworkers, agents, jobsPage] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    userService.listMyJobsForActiveContextPaginated({
      cursor,
      limit: 20,
      memberId,
      agentId,
      status: jobStatus,
    }),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentPreviewSeedById = new Map(
    agents.map((agent) => [
      agent.id,
      {
        name: agent.name,
        icon: agent.icon ?? null,
      },
    ]),
  );
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
    memberPreviewByUserId: new Map(
      memberPreviews.map((member) => [
        member.id,
        {
          name: member.name,
          image: member.image,
        },
      ]),
    ),
    agentPreviewSeedById,
  });

  return {
    jobs,
    nextCursor: jobsPage.nextCursor,
    agentPreviewById,
  };
}
