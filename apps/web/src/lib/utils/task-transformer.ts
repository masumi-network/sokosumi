import type { Coworker } from "@/lib/clients/generated/core";
import type {
  Task,
  TaskEvent,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import type { TaskWithCoworker } from "@/lib/types/task";
import { parseMentions } from "@/lib/utils/mention-parser";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";
import { getColumnId } from "@/lib/utils/task-column";

export function normalizeTaskNameForCoreApi(name: string): string {
  return name.trim();
}

function getCommentsCount(events: TaskEvent[]): number {
  return events.filter((event) => Boolean(event.comment)).length;
}

function parseAgentMentions(
  description: string | null | undefined,
  agentsById: Map<string, CoreAgentDto>,
): string[] {
  if (!description) return [];

  const matches = parseMentions(description);
  const resolvedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const mention of matches) {
    if (!agentsById.has(mention.id) || seenIds.has(mention.id)) continue;
    seenIds.add(mention.id);
    resolvedIds.push(mention.id);
  }

  return resolvedIds;
}

function replaceMentionsWithAgentNames(
  description: string | null | undefined,
  agentsById: Map<string, CoreAgentDto>,
): string | null {
  if (description === null || description === undefined) {
    return null;
  }

  const matches = parseMentions(description);
  if (matches.length === 0) {
    return description;
  }

  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    if (match.start > lastIndex) {
      result += description.slice(lastIndex, match.start);
    }

    const agentName = agentsById.get(match.id)?.name;

    result += agentName
      ? `@${agentName}`
      : description.slice(match.start, match.end);

    lastIndex = match.end;
  }

  if (lastIndex < description.length) {
    result += description.slice(lastIndex);
  }

  return result;
}

export function mapTaskToTaskWithCoworker(
  task: TaskListItem | Task,
  coworkersById: Map<string, Coworker>,
  agentsById: Map<string, CoreAgentDto>,
): TaskWithCoworker {
  const coworker = task.coworkerId
    ? (coworkersById.get(task.coworkerId) ?? null)
    : null;
  const agentIds = parseAgentMentions(task.description, agentsById);
  const agents = agentIds
    .map((id) => agentsById.get(id))
    .filter((agent): agent is CoreAgentDto => Boolean(agent));
  const descriptionPlain = stripMarkdownToText(
    replaceMentionsWithAgentNames(task.description, agentsById),
  )?.slice(0, 200);
  const createdAt = task.createdAt.toISOString();
  const updatedAt = task.updatedAt.toISOString();
  const nextRunAt = task.nextRunAt?.toISOString() ?? null;

  return {
    id: task.id,
    name: task.name,
    status: task.status,
    userId: task.userId,
    user: task.user,
    createdAt,
    updatedAt,
    nextRunAt,
    metadata: task.metadata ?? null,
    jobsCount: "jobsCount" in task ? task.jobsCount : task.jobs.length,
    coworker,
    share: "share" in task ? (task.share ?? null) : null,
    agents,
    commentsCount:
      "commentsCount" in task
        ? task.commentsCount
        : getCommentsCount(task.events),
    columnId: getColumnId(task.status, {
      pendingApproval: "pendingApproval" in task ? task.pendingApproval : false,
    }),
    description: task.description ?? null,
    descriptionPlain,
    pendingApproval: "pendingApproval" in task ? task.pendingApproval : false,
    events: "events" in task ? task.events : [],
  };
}
