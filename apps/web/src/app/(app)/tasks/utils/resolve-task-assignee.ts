import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type {
  Coworker,
  TaskAssignee,
  TaskListItem,
} from "@/lib/clients/generated/core";

import { getCoworkerImage } from "./coworker-image";

const EMPTY_VENDOR_LOGOS = { light: null, dark: null } as const;

export interface TaskAssigneeDisplay {
  name: string | null;
  image: string | null;
  avatarSeed?: string | null;
}

/** Display name/image for task metadata and activity (coworker or PA). */
export function resolveTaskAssigneeDisplay(
  assignee: TaskAssignee | undefined | null,
): TaskAssigneeDisplay {
  if (!assignee) {
    return { name: null, image: null };
  }

  if (assignee.type === "coworker") {
    return {
      name: assignee.coworker.name,
      image: getCoworkerImage(assignee.coworker),
    };
  }

  const orchestrator = assignee.orchestrator;
  const claimed = orchestrator.avatarImageUrl
    ? resolveIpfsOrHttpUrl(orchestrator.avatarImageUrl)
    : null;

  return {
    name: orchestrator.name?.trim() || "Assistant",
    image: claimed,
    avatarSeed: claimed
      ? null
      : (orchestrator.avatarSeed ?? defaultOrbSeed(orchestrator.owner.id)),
  };
}

function coworkerSummaryToCoworker(
  summary: Extract<TaskAssignee, { type: "coworker" }>["coworker"],
): Coworker {
  return {
    id: summary.id,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: summary.slug,
    name: summary.name,
    vendor: {
      id: "unknown",
      name: "Unknown",
      slug: "unknown",
      logos: EMPTY_VENDOR_LOGOS,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    capabilities: ["tasks"],
    image: summary.image,
    baseURL: null,
  } satisfies Coworker;
}

function orchestratorAssigneeToCoworker(
  assignee: Extract<TaskAssignee, { type: "orchestrator" }>,
): Coworker {
  const orchestrator = assignee.orchestrator;
  return {
    id: assignee.id,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "assistant",
    name: orchestrator.name?.trim() || "Assistant",
    vendor: {
      id: "sokosumi",
      name: "Sokosumi",
      slug: "sokosumi",
      logos: EMPTY_VENDOR_LOGOS,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    capabilities: ["tasks"],
    image: orchestrator.avatarImageUrl,
    baseURL: null,
  } satisfies Coworker;
}

/** Resolves task assignee for board/list display (coworker or owner PA). */
export function resolveTaskAssigneeCoworker(
  task: Pick<TaskListItem, "assigneeId" | "assignee">,
  coworkersById: Map<string, Coworker>,
): Coworker | null {
  const assignee = task.assignee;
  if (assignee?.type === "coworker") {
    return (
      coworkersById.get(assignee.id) ??
      coworkerSummaryToCoworker(assignee.coworker)
    );
  }
  if (assignee?.type === "orchestrator") {
    return orchestratorAssigneeToCoworker(assignee);
  }
  if (task.assigneeId) {
    return coworkersById.get(task.assigneeId) ?? null;
  }
  return null;
}
