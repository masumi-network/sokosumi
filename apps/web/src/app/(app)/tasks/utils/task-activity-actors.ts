import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { defaultOrbSeed } from "@/lib/aurora-orb";

import type { Task, TaskEvent } from "@/lib/clients/generated/core/types.gen";

import { getCoworkerImage } from "./coworker-image";

export interface TaskActivityActorInfo {
  name: string;
  image: string | null;
  avatarSeed?: string | null;
  /** Present for sokoBot actors — format with i18n at render. */
  ownerName?: string;
}

export interface TaskActivityActors {
  userById: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  sokoBotById?: Record<string, TaskActivityActorInfo>;
}

export type TaskEventActorKind = "user" | "coworker" | "sokoBot";

type TaskActivityActorSource = Pick<
  Task,
  "owner" | "assignee" | "creator" | "events"
>;

type SokoBotActorSummary = {
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

  // Match Core prefer order: sokoBot → coworker → user.
  if (event.sokoBotId) {
    return "sokoBot";
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
  sokoBotById?: Record<string, TaskActivityActorInfo>,
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
      case "sokoBot":
        return sokoBotActorInfo(event.actor.sokoBot);
      default: {
        const _exhaustive: never = event.actor;
        return _exhaustive;
      }
    }
  }

  // Deprecated flat aliases — remove once clients always receive nested actor.
  // Prefer order matches Core: sokoBot → coworker → user.
  if (event.sokoBotId) {
    if (event.sokoBot) {
      return sokoBotActorInfo(event.sokoBot);
    }

    return sokoBotById?.[event.sokoBotId];
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
  const sokoBotById: Record<string, TaskActivityActorInfo> = {};

  addUserActor(userById, task.owner);

  if (task.assignee) {
    if (task.assignee.type === "sokoBot") {
      addSokoBotActor(sokoBotById, task.assignee.sokoBot);
    } else if (task.assignee.type === "user") {
      addUserActor(userById, task.assignee.user);
    } else {
      addCoworkerActor(coworkerById, task.assignee.coworker);
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
    case "sokoBot":
      if (task.creator.sokoBot) {
        addSokoBotActor(sokoBotById, task.creator.sokoBot);
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
        case "sokoBot":
          addSokoBotActor(sokoBotById, event.actor.sokoBot);
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

    if (event.sokoBot) {
      addSokoBotActor(sokoBotById, event.sokoBot);
    }
  }

  return {
    userById,
    coworkerById:
      Object.keys(coworkerById).length > 0 ? coworkerById : undefined,
    sokoBotById: Object.keys(sokoBotById).length > 0 ? sokoBotById : undefined,
  };
}

function sokoBotActorInfo(sokoBot: SokoBotActorSummary): TaskActivityActorInfo {
  return {
    name: sokoBot.name ?? "Assistant",
    // A claimed mascot is the bot's face everywhere else; the orb is only the
    // fallback for a bot that has not picked one.
    image: sokoBot.avatarImageUrl
      ? resolveIpfsOrHttpUrl(sokoBot.avatarImageUrl)
      : null,
    // Same fallback the sidebar and the Soko Bots page use. `avatarSeed` is
    // null for every bot, and passing that through rendered a different face
    // here than the one the owner sees everywhere else.
    avatarSeed: sokoBot.avatarImageUrl
      ? null
      : (sokoBot.avatarSeed ?? defaultOrbSeed(sokoBot.owner.id)),
    ownerName: sokoBot.owner.name,
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

function addSokoBotActor(
  sokoBotById: Record<string, TaskActivityActorInfo>,
  sokoBot: SokoBotActorSummary,
) {
  sokoBotById[sokoBot.id] = sokoBotActorInfo(sokoBot);
}
