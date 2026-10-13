import type { Prisma } from "@sokosumi/database";
import { TaskVisibility } from "@sokosumi/database";
import {
  buildHumanParentTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
  type SokoBotPacketAudience,
  type SokoBotScope,
} from "@/helpers/task-visibility";

/** Who a context packet is built for, and what it may read. */
export interface ContextPacketReaderInput {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
  /**
   * Who the turn answers. A teammate mentioning someone else's bot in a shared
   * room receives the model's answer in that room, so the packet must not carry
   * the owner's private surfaces even though the turn runs as the owner.
   */
  audience?: "OWNER" | "TEAMMATE";
  /**
   * Who is on the other side of this turn. The turn runs as the owner (their
   * bot, their credits), so `actor` is always the owner, and without this the
   * packet asserts the owner is the one speaking: a bot reading that greets
   * its owner by name at a teammate.
   *
   * `ASSISTANT` is another bot asking, and is deliberately nameless. The id
   * that reaches us then belongs to the *sending bot's owner*, who is not in
   * the conversation at all, so naming them would be worse than saying
   * nothing.
   */
  askedByKind?: SokoBotPacketAudience;
  askedByUserId?: string | null;
  roomId?: string | null;
  /** Null for a personal bot. */
  sharedScope: SokoBotScope | null;
}

/** The filters every packet read takes, one per collection. */
export interface ContextPacketScope {
  askedByKind: SokoBotPacketAudience;
  /** Whose name the packet looks up as the asker, if anyone's. */
  askerUserId: string | null;
  /** Owner reminders reach only the owner's own packets. */
  includeReminders: boolean;
  projectWhere: Prisma.ProjectWhereInput;
  taskWhere: Prisma.TaskWhereInput;
  /** Without `workspaceId`: callers add it, or it nests under a Project. */
  jobWhere: Prisma.JobWhereInput;
  coworkerAssignmentWhere: Prisma.CoworkerAssignmentWhereInput;
  pendingDecisionWhere: () => Prisma.SokoBotPendingDecisionWhereInput;
  recentTurnWhere: Prisma.SokoBotTurnWhereInput;
  memoryWhere: Prisma.SokoBotMemoryRevisionWhereInput;
}

const SETTLED_TURN_STATUSES: Prisma.SokoBotTurnWhereInput["status"] = {
  in: ["COMPLETED", "FAILED", "CANCELLED"],
};

/** Matches no row: Prisma reads an empty `in` as false. */
const NO_ASSIGNMENT: Prisma.CoworkerAssignmentWhereInput = { id: { in: [] } };

function roomWhere(roomId: string | null | undefined) {
  return roomId
    ? { chatMention: { message: { roomId } } }
    : { chatMentionId: null };
}

function personalPacketScope(
  input: ContextPacketReaderInput,
): ContextPacketScope {
  const askedByKind = input.askedByKind ?? "OWNER";
  const teammate = input.audience === "TEAMMATE";
  const taskWhere: Prisma.TaskWhereInput = teammate
    ? { visibility: TaskVisibility.PUBLIC }
    : buildSokoBotOwnerTaskVisibilityWhere(input.userId);
  const parentTask = teammate
    ? { visibility: TaskVisibility.PUBLIC }
    : buildHumanParentTaskVisibilityWhere(input.userId);
  const requestedByUserId =
    input.askedByUserId && input.askedByUserId !== input.userId
      ? input.askedByUserId
      : null;
  return {
    askedByKind,
    // The owner is already `actor`, and the id behind an assistant's question
    // is its owner, not the asker.
    askerUserId:
      askedByKind === "TEAMMATE" && requestedByUserId
        ? requestedByUserId
        : null,
    includeReminders: !teammate,
    projectWhere: { workspaceId: input.workspaceId },
    taskWhere,
    jobWhere: {
      ownerId: input.userId,
      OR: [{ taskId: null }, { task: { is: parentTask } }],
    },
    coworkerAssignmentWhere: { userId: input.userId },
    pendingDecisionWhere: () => ({
      userId: input.userId,
      workspaceId: input.workspaceId,
      status: "PENDING",
      sokoBotId: input.sokoBotId,
      expiresAt: { gt: new Date() },
      turn: { requestedByUserId, ...roomWhere(input.roomId) },
    }),
    recentTurnWhere: {
      sokoBotId: input.sokoBotId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      status: SETTLED_TURN_STATUSES,
      requestedByUserId,
      ...roomWhere(input.roomId),
    },
    memoryWhere: {
      sokoBotId: input.sokoBotId,
      sokoBot: { userId: input.userId },
    },
  };
}

/**
 * A shared bot has no owner, so its packet never speaks to one: the asker is
 * a teammate (or another assistant), Tasks and Jobs come from the bot's
 * scope, and turns and memory are the bot's own. Pending decisions stay the
 * asker's, since only the asker may answer them.
 */
function sharedPacketScope(
  input: ContextPacketReaderInput,
  scope: SokoBotScope,
): ContextPacketScope {
  const askedByKind =
    input.askedByKind === "ASSISTANT" ? "ASSISTANT" : "TEAMMATE";
  const askerUserId =
    askedByKind === "TEAMMATE" ? (input.askedByUserId ?? input.userId) : null;
  return {
    askedByKind,
    askerUserId,
    includeReminders: false,
    projectWhere: {
      workspaceId: scope.workspaceId,
      ...(scope.projectId === null ? {} : { id: scope.projectId }),
    },
    taskWhere: buildSokoBotScopeTaskWhere(scope),
    jobWhere: buildSokoBotScopeJobWhere(scope),
    coworkerAssignmentWhere: NO_ASSIGNMENT,
    pendingDecisionWhere: () => ({
      userId: input.userId,
      workspaceId: scope.workspaceId,
      status: "PENDING",
      sokoBotId: scope.sokoBotId,
      expiresAt: { gt: new Date() },
      turn: roomWhere(input.roomId),
    }),
    recentTurnWhere: {
      sokoBotId: scope.sokoBotId,
      workspaceId: scope.workspaceId,
      status: SETTLED_TURN_STATUSES,
      ...roomWhere(input.roomId),
    },
    memoryWhere: { sokoBotId: scope.sokoBotId },
  };
}

/**
 * The packet's third audience case: a personal bot reads as its owner or as
 * a teammate, a shared bot reads its scope. A shared scope must belong to
 * the packet's bot and workspace, or the packet refuses to build.
 */
export function contextPacketScope(
  input: ContextPacketReaderInput,
): ContextPacketScope {
  const scope = input.sharedScope;
  if (scope === null) return personalPacketScope(input);
  if (
    scope.sokoBotId !== input.sokoBotId ||
    scope.workspaceId !== input.workspaceId
  ) {
    throw new Error("Soko Bot scope does not match the packet");
  }
  return sharedPacketScope(input, scope);
}
