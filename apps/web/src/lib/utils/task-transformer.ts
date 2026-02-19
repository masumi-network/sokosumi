import type { AgentWithCreditsPrice, Coworker } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

import type { Task, TaskEvent } from "@/lib/clients/generated/core/types.gen";
import { type TaskWithCoworker } from "@/lib/types/task";
import { parseMentions } from "@/lib/utils/mention-parser";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

type TaskWithFlexibleDates = Omit<Task, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

function getColumnId(status: TaskStatus): TaskWithCoworker["columnId"] {
  switch (status) {
    case TaskStatus.DRAFT:
      return "backlog";
    case TaskStatus.READY:
      return "todo";
    case TaskStatus.RUNNING:
    case TaskStatus.AWAITING_EXTERNAL:
    case TaskStatus.CANCEL_REQUESTED:
    case TaskStatus.AUTHENTICATION_REQUIRED:
      return "in-progress";
    case TaskStatus.INPUT_REQUIRED:
    case TaskStatus.OUT_OF_CREDITS:
      return "input-required";
    case TaskStatus.COMPLETED:
    case TaskStatus.FAILED:
    case TaskStatus.CANCELED:
      return "done";
    default:
      return "todo";
  }
}

function getCommentsCount(events: TaskEvent[]): number {
  return events.filter((event) => Boolean(event.comment)).length;
}

function parseAgentMentions(
  description: string | null | undefined,
  agentsById: Map<string, AgentWithCreditsPrice>,
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
  agentsById: Map<string, AgentWithCreditsPrice>,
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
  task: TaskWithFlexibleDates,
  coworkersById: Map<string, Coworker>,
  agentsById: Map<string, AgentWithCreditsPrice>,
): TaskWithCoworker {
  const coworker = task.coworkerId
    ? (coworkersById.get(task.coworkerId) ?? null)
    : null;
  const agentIds = parseAgentMentions(task.description, agentsById);
  const agents = agentIds
    .map((id) => agentsById.get(id))
    .filter((agent): agent is AgentWithCreditsPrice => Boolean(agent));
  const descriptionPlain = stripMarkdownToText(
    replaceMentionsWithAgentNames(task.description, agentsById),
  )?.slice(0, 200);
  const createdAt =
    task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt;
  const updatedAt =
    task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt;

  return {
    id: task.id,
    name: task.name,
    status: task.status,
    userId: task.userId,
    createdAt,
    updatedAt,
    coworker,
    agents,
    commentsCount: getCommentsCount(task.events),
    columnId: getColumnId(task.status),
    description: task.description ?? null,
    descriptionPlain,
    events: task.events,
  };
}
