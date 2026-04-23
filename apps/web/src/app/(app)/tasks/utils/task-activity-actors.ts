import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import type { Task } from "@/lib/clients/generated/core/types.gen";

import { getCoworkerImage } from "./coworker-image";

export interface TaskActivityActorInfo {
  name: string;
  image: string | null;
}

export interface TaskActivityCurrentUser extends TaskActivityActorInfo {
  id: string;
}

export interface TaskActivityActors {
  userById: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  currentUser: TaskActivityCurrentUser;
}

export function buildTaskActivityActors(
  task: Pick<Task, "user" | "coworker" | "events">,
): TaskActivityActors {
  const userById: Record<string, TaskActivityActorInfo> = {};
  const coworkerById: Record<string, TaskActivityActorInfo> = {};

  addUserActor(userById, task.user);

  if (task.coworker) {
    addCoworkerActor(coworkerById, task.coworker);
  }

  for (const event of task.events) {
    if (event.user) {
      addUserActor(userById, event.user);
    }

    if (event.coworker) {
      addCoworkerActor(coworkerById, event.coworker);
    }
  }

  return {
    userById,
    coworkerById:
      Object.keys(coworkerById).length > 0 ? coworkerById : undefined,
    currentUser: {
      id: task.user.id,
      name: task.user.name,
      image: getUserImage(task.user.image),
    },
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
    image: getUserImage(user.image),
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

function getUserImage(image: string | null | undefined): string | null {
  return image ? resolveIpfsOrHttpUrl(image) : null;
}
