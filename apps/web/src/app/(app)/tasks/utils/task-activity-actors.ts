import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import type { Task } from "@/lib/clients/generated/core/types.gen";

import { getCoworkerImage } from "./coworker-image";

export interface TaskActivityActorInfo {
  name: string;
  image: string | null;
}

export interface TaskActivityActors {
  userById: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  orchestratorById?: Record<string, TaskActivityActorInfo>;
}

type TaskActivityActorSource = Pick<
  Task,
  "owner" | "assignee" | "creator" | "events"
>;

export function buildTaskActivityActors(
  task: TaskActivityActorSource,
): TaskActivityActors {
  const userById: Record<string, TaskActivityActorInfo> = {};
  const coworkerById: Record<string, TaskActivityActorInfo> = {};
  const orchestratorById: Record<string, TaskActivityActorInfo> = {};

  addUserActor(userById, task.owner);

  if (task.assignee) {
    addCoworkerActor(coworkerById, task.assignee);
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
  orchestrator: {
    id: string;
    name: string;
  },
) {
  orchestratorById[orchestrator.id] = {
    name: orchestrator.name,
    image: null,
  };
}
