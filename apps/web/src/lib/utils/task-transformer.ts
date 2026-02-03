import type {
  AgentWithCreditsPrice,
  Orchestrator,
  TaskEvent,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

import type { TaskWithEvents } from "@/lib/services/task.service";
import type { TaskWithOrchestrator } from "@/lib/types/task";
import { parseMentions } from "@/lib/utils/mention-parser";

function getColumnId(status: TaskStatus): TaskWithOrchestrator["columnId"] {
  switch (status) {
    case TaskStatus.DRAFT:
      return "backlog";
    case TaskStatus.READY:
      return "todo";
    case TaskStatus.RUNNING:
      return "in-progress";
    case TaskStatus.INPUT_REQUIRED:
      return "input-required";
    case TaskStatus.COMPLETED:
    case TaskStatus.FAILED:
      return "complete";
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

export function mapTaskToTaskWithOrchestrator(
  task: TaskWithEvents,
  orchestratorsById: Map<string, Orchestrator>,
  agentsById: Map<string, AgentWithCreditsPrice>,
): TaskWithOrchestrator {
  const orchestrator = task.orchestratorId
    ? (orchestratorsById.get(task.orchestratorId) ?? null)
    : null;
  const agentIds = parseAgentMentions(task.description, agentsById);
  const agents = agentIds
    .map((id) => agentsById.get(id))
    .filter((agent): agent is AgentWithCreditsPrice => Boolean(agent));
  const descriptionPlain = replaceMentionsWithAgentNames(
    task.description,
    agentsById,
  );

  return {
    id: task.id,
    name: task.name,
    status: task.status,
    userId: task.userId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    orchestrator,
    agents,
    commentsCount: getCommentsCount(task.events),
    columnId: getColumnId(task.status),
    description: task.description ?? null,
    descriptionPlain,
    events: task.events,
  };
}
