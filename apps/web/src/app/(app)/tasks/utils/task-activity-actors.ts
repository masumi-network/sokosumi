import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { defaultOrbSeed } from "@/lib/aurora-orb";

import type { Task, TaskEvent } from "@/lib/clients/generated/core/types.gen";

import { getCoworkerImage } from "./coworker-image";

export interface TaskActivityActorInfo {
  name: string;
  image: string | null;
  avatarSeed?: string | null;
  /** Present for orchestrator actors — format with i18n at render. */
  ownerName?: string;
}

export interface TaskActivityActors {
  userById: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  orchestratorById?: Record<string, TaskActivityActorInfo>;
}

export type TaskEventActorKind = "user" | "coworker" | "orchestrator";

type TaskActivityActorSource = Pick<
  Task,
  "owner" | "assignee" | "creator" | "events"
>;

type OrchestratorActorSummary = {
  id: string;
  name: string | null;
  avatarSeed?: string | null;
  avatarImageUrl?: string | null;
  owner: {
    id: string;
    name: string;
    image?: string | null;
  };
};

/**
 * Prefer nested `actor`. Fall back to deprecated flat FKs for older payloads.
 */
export function resolveTaskEventActorKind(
  event: TaskEvent,
): TaskEventActorKind | null {
  if (event.actor != null) {
    return event.actor.type;
  }

  // Match Core prefer order: orchestrator → coworker → user.
  if (event.orchestratorId) {
    return "orchestrator";
  }

  if (event.coworkerId) {
    return "coworker";
  }

  if (event.userId) {
    return "user";
  }

  return null;
}

export function getEventActorInfo(
  event: TaskEvent,
  userById?: Record<string, TaskActivityActorInfo>,
  coworkerById?: Record<string, TaskActivityActorInfo>,
  orchestratorById?: Record<string, TaskActivityActorInfo>,
): TaskActivityActorInfo | undefined {
  if (event.actor != null) {
    switch (event.actor.type) {
      case "user":
        return {
          name: event.actor.user.name,
          image: event.actor.user.image
            ? resolveIpfsOrHttpUrl(event.actor.user.image)
            : null,
        };
      case "coworker": {
        if (event.actor.coworker == null) {
          return coworkerById?.[event.actor.id];
        }

        return {
          name: event.actor.coworker.name,
          image: getCoworkerImage(event.actor.coworker),
        };
      }
      case "orchestrator":
        return orchestratorActorInfo(event.actor.orchestrator);
      default: {
        const _exhaustive: never = event.actor;
        return _exhaustive;
      }
    }
  }

  // Deprecated flat aliases — remove once clients always receive nested actor.
  // Prefer order matches Core: orchestrator → coworker → user.
  if (event.orchestratorId) {
    if (event.orchestrator) {
      return orchestratorActorInfo(event.orchestrator);
    }

    return orchestratorById?.[event.orchestratorId];
  }

  if (event.coworkerId) {
    if (event.coworker) {
      return {
        name: event.coworker.name,
        image: getCoworkerImage(event.coworker),
      };
    }

    return coworkerById?.[event.coworkerId];
  }

  if (event.userId) {
    if (event.user) {
      return {
        name: event.user.name,
        image: event.user.image ? resolveIpfsOrHttpUrl(event.user.image) : null,
      };
    }

    return userById?.[event.userId];
  }

  return undefined;
}

export function buildTaskActivityActors(
  task: TaskActivityActorSource,
): TaskActivityActors {
  const userById: Record<string, TaskActivityActorInfo> = {};
  const coworkerById: Record<string, TaskActivityActorInfo> = {};
  const orchestratorById: Record<string, TaskActivityActorInfo> = {};

  addUserActor(userById, task.owner);

  if (task.assignee) {
    switch (task.assignee.type) {
      case "coworker":
        addCoworkerActor(coworkerById, task.assignee.coworker);
        break;
      case "orchestrator":
        addOrchestratorActor(orchestratorById, task.assignee.orchestrator);
        break;
      default: {
        const _exhaustive: never = task.assignee;
        void _exhaustive;
      }
    }
  }

  switch (task.creator.type) {
    case "user":
      if (task.creator.id !== task.owner.id) {
        addUserActor(userById, task.creator.user);
      }
      break;
    case "coworker":
      if (task.creator.coworker) {
        addCoworkerActor(coworkerById, task.creator.coworker);
      }
      break;
    case "orchestrator":
      if (task.creator.orchestrator) {
        addOrchestratorActor(orchestratorById, task.creator.orchestrator);
      }
      break;
    default: {
      const _exhaustive: never = task.creator;
      void _exhaustive;
    }
  }

  for (const event of task.events) {
    if (event.actor != null) {
      switch (event.actor.type) {
        case "user":
          addUserActor(userById, event.actor.user);
          break;
        case "coworker":
          if (event.actor.coworker != null) {
            addCoworkerActor(coworkerById, event.actor.coworker);
          }
          break;
        case "orchestrator":
          addOrchestratorActor(orchestratorById, event.actor.orchestrator);
          break;
        default: {
          const _exhaustive: never = event.actor;
          void _exhaustive;
        }
      }
      continue;
    }

    // Deprecated flat aliases for events without nested actor yet.
    if (event.user) {
      addUserActor(userById, event.user);
    }

    if (event.coworker) {
      addCoworkerActor(coworkerById, event.coworker);
    }

    if (event.orchestrator) {
      addOrchestratorActor(orchestratorById, event.orchestrator);
    }
  }

  return {
    userById,
    coworkerById:
      Object.keys(coworkerById).length > 0 ? coworkerById : undefined,
    orchestratorById:
      Object.keys(orchestratorById).length > 0 ? orchestratorById : undefined,
  };
}

function orchestratorActorInfo(
  orchestrator: OrchestratorActorSummary,
): TaskActivityActorInfo {
  return {
    name: orchestrator.name ?? "Assistant",
    // A claimed mascot is the bot's face everywhere else; the orb is only the
    // fallback for a bot that has not picked one.
    image: orchestrator.avatarImageUrl
      ? resolveIpfsOrHttpUrl(orchestrator.avatarImageUrl)
      : null,
    // Same fallback the sidebar and the Soko Bots page use. `avatarSeed` is
    // null for every bot, and passing that through rendered a different face
    // here than the one the owner sees everywhere else.
    avatarSeed: orchestrator.avatarImageUrl
      ? null
      : (orchestrator.avatarSeed ?? defaultOrbSeed(orchestrator.owner.id)),
    ownerName: orchestrator.owner.name,
  };
}

function addUserActor(
  userById: Record<string, TaskActivityActorInfo>,
  user: {
    id: string;
    name: string;
    image?: string | null;
  },
) {
  userById[user.id] = {
    name: user.name,
    image: user.image ? resolveIpfsOrHttpUrl(user.image) : null,
  };
}

function addCoworkerActor(
  coworkerById: Record<string, TaskActivityActorInfo>,
  coworker: {
    id: string;
    name: string;
    image?: string | null;
    slug: string;
  },
) {
  coworkerById[coworker.id] = {
    name: coworker.name,
    image: getCoworkerImage(coworker),
  };
}

function addOrchestratorActor(
  orchestratorById: Record<string, TaskActivityActorInfo>,
  orchestrator: OrchestratorActorSummary,
) {
  orchestratorById[orchestrator.id] = orchestratorActorInfo(orchestrator);
}
