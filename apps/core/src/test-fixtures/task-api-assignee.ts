/** Builds OpenAPI-valid task assignee fields for route test mocks. */
export function buildTaskApiAssigneeFields(task: Record<string, unknown>): {
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
  assignee:
    | {
        type: "coworker";
        id: string;
        coworker: {
          id: string;
          name: string;
          image: string | null;
          slug: string;
        };
      }
    | {
        type: "orchestrator";
        id: string;
        orchestrator: {
          id: string;
          name: string | null;
          avatarSeed: string | null;
          avatarImageUrl: string | null;
          owner: { id: string; name: string; image: string | null };
        };
      }
    | null;
  coworkerId: string | null;
  coworker: {
    id: string;
    name: string;
    image: string | null;
    slug: string;
  } | null;
} {
  const existingAssignee = task.assignee as
    | { type: "coworker" | "orchestrator"; id: string }
    | null
    | undefined;

  if (existingAssignee?.type === "orchestrator") {
    const orchestrator = (existingAssignee as { orchestrator?: object })
      .orchestrator ??
      (task.assigneeOrchestrator as object | null | undefined) ?? {
        id: existingAssignee.id,
        name: "Assistant",
        avatarSeed: null,
        avatarImageUrl: null,
        owner: { id: "user_fallback", name: "Owner", image: null },
      };

    return {
      assigneeId: null,
      assigneeOrchestratorId: existingAssignee.id,
      assignee: {
        type: "orchestrator",
        id: existingAssignee.id,
        orchestrator: orchestrator as {
          id: string;
          name: string | null;
          avatarSeed: string | null;
          avatarImageUrl: string | null;
          owner: { id: string; name: string; image: string | null };
        },
      },
      coworkerId: null,
      coworker: null,
    };
  }

  if (existingAssignee?.type === "coworker") {
    const coworker = (existingAssignee as { coworker?: object }).coworker ??
      (task.assignee as object | null | undefined) ?? {
        id: existingAssignee.id,
        name: "Coworker",
        image: null,
        slug: "coworker",
      };

    return {
      assigneeId: existingAssignee.id,
      assigneeOrchestratorId: null,
      assignee: {
        type: "coworker",
        id: existingAssignee.id,
        coworker: coworker as {
          id: string;
          name: string;
          image: string | null;
          slug: string;
        },
      },
      coworkerId: existingAssignee.id,
      coworker: coworker as {
        id: string;
        name: string;
        image: string | null;
        slug: string;
      },
    };
  }

  const assigneeOrchestratorId =
    (task.assigneeOrchestratorId as string | null | undefined) ?? null;
  if (assigneeOrchestratorId != null) {
    const orchestrator = (task.assigneeOrchestrator as
      | object
      | null
      | undefined) ?? {
      id: assigneeOrchestratorId,
      name: "Assistant",
      avatarSeed: null,
      avatarImageUrl: null,
      owner: { id: "user_fallback", name: "Owner", image: null },
    };

    return {
      assigneeId: null,
      assigneeOrchestratorId,
      assignee: {
        type: "orchestrator",
        id: assigneeOrchestratorId,
        orchestrator: orchestrator as {
          id: string;
          name: string | null;
          avatarSeed: string | null;
          avatarImageUrl: string | null;
          owner: { id: string; name: string; image: string | null };
        },
      },
      coworkerId: null,
      coworker: null,
    };
  }

  const assigneeId = (task.assigneeId as string | null | undefined) ?? null;
  if (assigneeId != null) {
    const legacyAssignee = task.assignee as
      | {
          id: string;
          name: string;
          image: string | null;
          slug: string;
        }
      | null
      | undefined;
    const coworker = legacyAssignee ?? {
      id: assigneeId,
      name: "Coworker",
      image: null,
      slug: "coworker",
    };

    return {
      assigneeId,
      assigneeOrchestratorId: null,
      assignee: {
        type: "coworker",
        id: assigneeId,
        coworker,
      },
      coworkerId: assigneeId,
      coworker,
    };
  }

  return {
    assigneeId: null,
    assigneeOrchestratorId: null,
    assignee: null,
    coworkerId: null,
    coworker: null,
  };
}
