import type { Prisma } from "@sokosumi/database";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import {
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "@/services/soko-bot-runtime.service";
import { taskScheduleVisibilityWhere } from "@/services/task-schedule-read.service";
import {
  containsExactName,
  mentionedSocialProviders,
  type NamedProjectCandidate,
  namedProjectsByTargetResolver,
  socialDestinationLabel,
  socialHandleOf,
  withoutQuotedCopy,
} from "./ask-policy-match";

const MAX_CANDIDATE_PROJECTS = 200;
const MAX_SHOWN_CANDIDATES = 10;
const MAX_RUN_DEPTH = 8;

const EDITABLE_POST_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
]);

export type TargetKind =
  | "account"
  | "project"
  | "post"
  | "schedule"
  | "newsletter";

export interface ResolvedTargetMetadata {
  kind: TargetKind;
  id: string;
  label: string;
  projectId?: string;
  autoResolved: boolean;
  reason: string;
}

export type TargetResolution<T> =
  | {
      status: "resolved";
      target: T;
      autoResolved: boolean;
      reason: string;
    }
  | {
      status: "ambiguous";
      candidates: readonly T[];
      reason: string;
    }
  | {
      status: "missing";
      reason: string;
    };

export interface OwnerChatRequest {
  id: string;
  createdAt: Date;
  userMessage: string;
  destinationRoomId: string | null;
}

/** True when the turn's version opts into E10's unified Core target resolver. */
export function isTargetResolverEnabled(
  versionId: string | null | undefined,
): boolean {
  return getSokoBotVersion(versionId).targetResolver === true;
}

/** The owner's own foreground chat turn (the only turn that asks or reads owner wording directly). */
export function isForegroundOwnerChat(
  authorized: AuthorizedSokoBotRuntime,
): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

/**
 * Shared pure 0 / 1 / 2+ target resolution rule used across accounts,
 * projects, posts, newsletters, and schedules.
 */
export function resolveTargetCandidate<T>(input: {
  candidates: readonly T[];
  named: readonly T[];
  emptyReason: string;
  ambiguousReason: (candidates: readonly T[]) => string;
  singleCandidateReason: (candidate: T) => string;
  namedCandidateReason: (candidate: T) => string;
}): TargetResolution<T> {
  if (input.candidates.length === 0) {
    return { status: "missing", reason: input.emptyReason };
  }
  if (input.named.length === 1) {
    const target = input.named[0]!;
    return {
      status: "resolved",
      target,
      autoResolved: true,
      reason: input.namedCandidateReason(target),
    };
  }
  if (input.named.length > 1) {
    return {
      status: "ambiguous",
      candidates: input.named,
      reason: input.ambiguousReason(input.named),
    };
  }
  if (input.candidates.length === 1) {
    const target = input.candidates[0]!;
    return {
      status: "resolved",
      target,
      autoResolved: true,
      reason: input.singleCandidateReason(target),
    };
  }
  return {
    status: "ambiguous",
    candidates: input.candidates,
    reason: input.ambiguousReason(input.candidates),
  };
}

/**
 * Walk `parentTurnId` up to `MAX_RUN_DEPTH` to find the originating owner chat
 * turn so background runs never treat their own brief as the owner's words.
 */
export async function loadOwnerChatRequest(
  turnId: string,
): Promise<OwnerChatRequest | null> {
  const select = {
    id: true,
    createdAt: true,
    userMessage: true,
    destinationRoomId: true,
    parentTurnId: true,
    source: true,
  } as const;
  let turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select,
  });
  for (let depth = 0; turn?.parentTurnId; depth += 1) {
    if (depth === MAX_RUN_DEPTH) return null;
    turn = await prisma.sokoBotTurn.findUnique({
      where: { id: turn.parentTurnId },
      select,
    });
  }
  return turn && (turn.source === "CHAT" || turn.source === "ADMIN_RETRY")
    ? turn
    : null;
}

function scopedBotProjectId(
  authorized: AuthorizedSokoBotRuntime,
): string | null {
  return (
    authorized.turn.botProjectId ??
    authorized.reader?.sharedScope?.projectId ??
    null
  );
}

function formatCapped<T>(
  items: readonly T[],
  format: (item: T) => string,
): string {
  const shown = items.slice(0, MAX_SHOWN_CANDIDATES).map(format).join("; ");
  const extra = items.length - MAX_SHOWN_CANDIDATES;
  return extra > 0 ? `${shown}; and ${extra} more` : shown;
}

function openProjectWhere(workspaceId: string, projectId: string | null) {
  return {
    workspaceId,
    closedAt: null,
    closingAt: null,
    ...(projectId ? { id: projectId } : {}),
  } as const;
}

/**
 * Unified project target check and optional auto-resolution for write tools.
 * - Single-project shared bots stay strictly confined to their own project.
 * - Optional-projectId writes (`create_task`, `hire_agent`, `save_task_schedule`,
 *   `send_message`) auto-resolve an omitted `projectId` ONLY when the owner's
 *   request uniquely names 1 open project (never forcing a project onto a
 *   project-free request).
 * - Explicit `projectId` mismatches against a uniquely named open project are
 *   refused across both optional and required project writes.
 * - Studio media writes (`mode: "studio_media"`) also validate against a single
 *   fitting project when the owner names 1 social network with 1 active project.
 */
export async function resolveProjectTargetForWrite(
  authorized: AuthorizedSokoBotRuntime,
  params: {
    projectId?: string | null;
    mode: "optional" | "required" | "studio_media";
    capability: string;
  },
): Promise<{
  projectId: string | null | undefined;
  resolvedTarget?: ResolvedTargetMetadata;
}> {
  if (!isTargetResolverEnabled(authorized.turn.versionId)) {
    return { projectId: params.projectId };
  }

  const botProjectId = scopedBotProjectId(authorized);
  if (botProjectId) {
    if (params.projectId && params.projectId !== botProjectId) {
      throw new SokoBotRefusedUnsentError(
        `This assistant works in one project only (projectId ${botProjectId}). Use that projectId for ${params.capability}.`,
      );
    }
    if (params.projectId === undefined && params.mode === "optional") {
      return {
        projectId: botProjectId,
        resolvedTarget: {
          kind: "project",
          id: botProjectId,
          label: botProjectId,
          projectId: botProjectId,
          autoResolved: true,
          reason: "Resolved to this shared assistant's only project.",
        },
      };
    }
    return { projectId: params.projectId };
  }

  if (!isForegroundOwnerChat(authorized)) {
    return { projectId: params.projectId };
  }

  const request = await loadOwnerChatRequest(authorized.turn.id);
  if (!request) return { projectId: params.projectId };

  const openProjects: NamedProjectCandidate[] = await prisma.project.findMany({
    where: openProjectWhere(authorized.turn.workspaceId, null),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATE_PROJECTS,
    select: { id: true, name: true },
  });

  const named = namedProjectsByTargetResolver(
    request.userMessage,
    openProjects,
  );

  if (named.length === 1) {
    const onlyNamed = named[0]!;
    if (params.projectId === undefined && params.mode === "optional") {
      return {
        projectId: onlyNamed.id,
        resolvedTarget: {
          kind: "project",
          id: onlyNamed.id,
          label: onlyNamed.name,
          projectId: onlyNamed.id,
          autoResolved: true,
          reason: `Resolved to Project "${onlyNamed.name}", the single open project named in the owner's request.`,
        },
      };
    }
    if (params.projectId && params.projectId !== onlyNamed.id) {
      throw new SokoBotRefusedUnsentError(
        `The owner named Project "${onlyNamed.name}" (projectId ${onlyNamed.id}). Run ${params.capability} on that project instead.`,
      );
    }
    return {
      projectId: params.projectId,
      ...(params.projectId === onlyNamed.id
        ? {
            resolvedTarget: {
              kind: "project" as const,
              id: onlyNamed.id,
              label: onlyNamed.name,
              projectId: onlyNamed.id,
              autoResolved: false,
              reason: `Matches Project "${onlyNamed.name}" named in the owner's request.`,
            },
          }
        : {}),
    };
  }

  if (params.mode === "studio_media" && named.length === 0) {
    const providers = mentionedSocialProviders(request.userMessage);
    if (providers.length === 1) {
      const provider = providers[0]!;
      const connections = await prisma.projectSocialConnection.findMany({
        where: {
          provider,
          status: "active",
          project: openProjectWhere(authorized.turn.workspaceId, null),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          project: { select: { id: true, name: true } },
        },
      });
      const uniqueProjects = new Map<string, NamedProjectCandidate>();
      for (const connection of connections) {
        uniqueProjects.set(connection.project.id, connection.project);
      }
      if (uniqueProjects.size === 1) {
        const [fitting] = [...uniqueProjects.values()];
        if (fitting) {
          const label = socialPostProviderLabel(provider);
          if (params.projectId && params.projectId !== fitting.id) {
            throw new SokoBotRefusedUnsentError(
              `Project "${fitting.name}" (projectId ${fitting.id}) is the only open project with an active ${label} account. Run ${params.capability} there instead, or ask the owner if another project was meant.`,
            );
          }
          if (params.projectId === fitting.id) {
            return {
              projectId: params.projectId,
              resolvedTarget: {
                kind: "project",
                id: fitting.id,
                label: fitting.name,
                projectId: fitting.id,
                autoResolved: false,
                reason: `Only open project with an active ${label} account.`,
              },
            };
          }
        }
      }
    }
  }

  return { projectId: params.projectId };
}

/**
 * Unified newsletter write target check (0 / 1 / 2+ newsletters in scope,
 * preserving explicitly named project constraints without substitution).
 */
export async function resolveNewsletterTargetForWrite(
  authorized: AuthorizedSokoBotRuntime,
  params: { projectId: string; capability: string },
): Promise<{ resolvedTarget?: ResolvedTargetMetadata }> {
  if (
    !isTargetResolverEnabled(authorized.turn.versionId) ||
    !isForegroundOwnerChat(authorized)
  ) {
    return {};
  }

  const botProjectId = scopedBotProjectId(authorized);
  if (botProjectId && params.projectId !== botProjectId) {
    throw new SokoBotRefusedUnsentError(
      `This assistant works in one project only (projectId ${botProjectId}). Use that projectId for ${params.capability}.`,
    );
  }

  const request = await loadOwnerChatRequest(authorized.turn.id);
  const projectWhere = openProjectWhere(
    authorized.turn.workspaceId,
    botProjectId,
  );
  const [openProjects, newsletters] = await Promise.all([
    botProjectId
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: projectWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_CANDIDATE_PROJECTS,
          select: { id: true, name: true },
        }),
    prisma.newsletter.findMany({
      where: {
        workspaceId: authorized.turn.workspaceId,
        ...(botProjectId ? { projectId: botProjectId } : {}),
        project: projectWhere,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        projectId: true,
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  const namedProjects =
    !botProjectId && request
      ? namedProjectsByTargetResolver(request.userMessage, openProjects)
      : [];

  if (namedProjects.length === 1 && params.projectId !== namedProjects[0]!.id) {
    const wanted = namedProjects[0]!;
    throw new SokoBotRefusedUnsentError(
      `The owner named Project "${wanted.name}" (projectId ${wanted.id}). Run ${params.capability} on that project instead.`,
    );
  }

  const onProject = newsletters.find(
    (newsletter) => newsletter.projectId === params.projectId,
  );
  if (!onProject) {
    if (namedProjects.length > 0 || newsletters.length === 0) {
      throw new SokoBotRefusedUnsentError(
        "No newsletter is set up on the requested project. Tell the owner what is missing and make no changes.",
      );
    }
    if (newsletters.length === 1) {
      const only = newsletters[0]!;
      throw new SokoBotRefusedUnsentError(
        `Project "${only.project.name}" (projectId ${only.projectId}) holds the only newsletter ("${only.name}") in scope. Use that projectId instead.`,
      );
    }
    throw new SokoBotRefusedUnsentError(
      `No newsletter is set up on projectId ${params.projectId}. Available newsletters: ${formatCapped(newsletters, (n) => `"${n.name}" (Project "${n.project.name}", projectId ${n.projectId})`)}. Ask the owner once which one to use.`,
    );
  }

  if (newsletters.length === 1) {
    return {
      resolvedTarget: {
        kind: "newsletter",
        id: onProject.id,
        label: `${onProject.name} (${onProject.project.name})`,
        projectId: onProject.projectId,
        autoResolved: false,
        reason: "Only newsletter set up in scope.",
      },
    };
  }

  const cleanedMessage = request ? withoutQuotedCopy(request.userMessage) : "";
  const namedNewsletters = request
    ? newsletters.filter((newsletter) => {
        if (
          cleanedMessage.includes(newsletter.id) ||
          cleanedMessage.includes(newsletter.projectId)
        ) {
          return true;
        }
        const trimmedName = newsletter.name.trim();
        if (
          trimmedName.length >= 3 &&
          containsExactName(cleanedMessage, trimmedName)
        ) {
          return true;
        }
        return namedProjects.some(
          (project) => project.id === newsletter.projectId,
        );
      })
    : [];

  const resolution = resolveTargetCandidate({
    candidates: newsletters,
    named: namedNewsletters,
    emptyReason: "No newsletter is set up in scope.",
    ambiguousReason: (candidates) =>
      `Several projects have newsletters set up (${formatCapped(candidates, (n) => `"${n.name}" (Project "${n.project.name}", projectId ${n.projectId})`)}). Ask the owner once which newsletter to use and make no changes until they answer.`,
    singleCandidateReason: (candidate) =>
      `Only newsletter in scope ("${candidate.name}").`,
    namedCandidateReason: (candidate) =>
      `Matches newsletter "${candidate.name}" named in the owner's request.`,
  });

  if (resolution.status === "ambiguous") {
    throw new SokoBotRefusedUnsentError(resolution.reason);
  }
  if (resolution.status === "missing") {
    throw new SokoBotRefusedUnsentError(resolution.reason);
  }
  if (resolution.target.projectId !== params.projectId) {
    throw new SokoBotRefusedUnsentError(
      `The owner named newsletter "${resolution.target.name}" on Project "${resolution.target.project.name}" (projectId ${resolution.target.projectId}). Use that projectId instead.`,
    );
  }

  return {
    resolvedTarget: {
      kind: "newsletter",
      id: resolution.target.id,
      label: `${resolution.target.name} (${resolution.target.project.name})`,
      projectId: resolution.target.projectId,
      autoResolved: false,
      reason: resolution.reason,
    },
  };
}

/**
 * Unified social post write target check (`update_social_post`,
 * `schedule_social_post`, `cancel_social_post`, `publish_social_post`).
 * Verifies post existence on `projectId` and gives an exact corrective project
 * or editable-post list when mismatched (strictly respecting shared-bot scope).
 */
export async function resolveSocialPostTargetForWrite(
  authorized: AuthorizedSokoBotRuntime,
  params: { projectId: string; postId: string; capability: string },
): Promise<{
  existingSocialConnectionId?: string | null;
  resolvedTarget?: ResolvedTargetMetadata;
}> {
  if (!isTargetResolverEnabled(authorized.turn.versionId)) {
    return {};
  }

  const botProjectId = scopedBotProjectId(authorized);
  if (botProjectId && params.projectId !== botProjectId) {
    throw new SokoBotRefusedUnsentError(
      `This assistant works in one project only (projectId ${botProjectId}). Use that projectId for ${params.capability}.`,
    );
  }

  if (!botProjectId && isForegroundOwnerChat(authorized)) {
    const request = await loadOwnerChatRequest(authorized.turn.id);
    if (request && !request.userMessage.includes(params.postId)) {
      const openProjects = await prisma.project.findMany({
        where: openProjectWhere(authorized.turn.workspaceId, null),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_CANDIDATE_PROJECTS,
        select: { id: true, name: true },
      });
      const named = namedProjectsByTargetResolver(
        request.userMessage,
        openProjects,
      );
      if (named.length === 1 && params.projectId !== named[0]!.id) {
        throw new SokoBotRefusedUnsentError(
          `The owner named Project "${named[0]!.name}" (projectId ${named[0]!.id}). Run ${params.capability} on that project instead.`,
        );
      }
    }
  }

  const existing = await prisma.socialPost.findFirst({
    where: {
      id: params.postId,
      projectId: params.projectId,
      project: { workspaceId: authorized.turn.workspaceId },
    },
    select: {
      id: true,
      status: true,
      revision: true,
      socialConnectionId: true,
    },
  });
  if (existing) {
    return {
      existingSocialConnectionId: existing.socialConnectionId,
      resolvedTarget: {
        kind: "post",
        id: existing.id,
        label: `Social post (${existing.status})`,
        projectId: params.projectId,
        autoResolved: false,
        reason: "Verified target social post in project.",
      },
    };
  }

  if (!botProjectId) {
    const elsewhere = await prisma.socialPost.findFirst({
      where: {
        id: params.postId,
        project: openProjectWhere(authorized.turn.workspaceId, null),
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
    if (elsewhere) {
      throw new SokoBotRefusedUnsentError(
        `Post ${params.postId} belongs to Project "${elsewhere.project.name}" (projectId ${elsewhere.projectId}), not projectId ${params.projectId}. Pass projectId ${elsewhere.projectId}.`,
      );
    }
  }

  const editable = await prisma.socialPost.findMany({
    where: {
      projectId: params.projectId,
      project: { workspaceId: authorized.turn.workspaceId },
      status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 6,
    select: { id: true, status: true, revision: true },
  });

  if (editable.length === 0) {
    throw new SokoBotRefusedUnsentError(
      `Post ${params.postId} was not found, and this project has 0 editable social posts.`,
    );
  }
  if (editable.length === 1) {
    const only = editable[0]!;
    throw new SokoBotRefusedUnsentError(
      `Post ${params.postId} was not found on this project. The only editable post here is postId ${only.id} (status ${only.status}, revision ${only.revision}). Read it with get_social_post before editing.`,
    );
  }
  throw new SokoBotRefusedUnsentError(
    `Post ${params.postId} was not found on this project. Existing editable posts: ${formatCapped(editable, (p) => `postId ${p.id} (${p.status}, rev ${p.revision})`)}. Call list_social_posts to confirm the target.`,
  );
}

/**
 * Unified schedule target resolver for `update_schedule` and `delete_schedule`:
 * - Detects Task Schedule UUIDs passed to bot-schedule tools and points to
 *   `save_task_schedule` / `delete_task_schedule`.
 * - Resolves unambiguous word-bounded custom `scheduleName` matches when no
 *   exact literal match exists, excluding built-in rhythms when changing
 *   prompt/name or deleting; refuses with all matching IDs on ambiguity.
 */
export async function resolveBotScheduleTargetForWrite(
  authorized: AuthorizedSokoBotRuntime,
  params: {
    scheduleId?: string;
    scheduleName?: string;
    capability: "update_schedule" | "delete_schedule";
    changesPromptOrName?: boolean;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<{
  scheduleId?: string;
  resolvedTarget?: ResolvedTargetMetadata;
}> {
  if (
    !isTargetResolverEnabled(authorized.turn.versionId) ||
    authorized.turn.source === "SCHEDULE"
  ) {
    return { scheduleId: params.scheduleId };
  }

  const { sokoBotId, workspaceId, actingUserId } = authorized.turn;
  const activeSchedules = await db.sokoBotSchedule.findMany({
    where: {
      sokoBotId,
      NOT: { runOnce: true, enabled: false, lastRunAt: { not: null } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, systemKey: true },
  });

  if (params.scheduleId) {
    const ownMatch = activeSchedules.find(
      (row) => row.id === params.scheduleId,
    );
    if (ownMatch) {
      return {
        scheduleId: ownMatch.id,
        resolvedTarget: {
          kind: "schedule",
          id: ownMatch.id,
          label: ownMatch.name,
          autoResolved: false,
          reason: `Matched bot schedule "${ownMatch.name}".`,
        },
      };
    }
    if (actingUserId && isForegroundOwnerChat(authorized)) {
      const taskSched = await db.taskSchedule.findFirst({
        where: {
          id: params.scheduleId,
          workspaceId,
          ...taskScheduleVisibilityWhere({
            kind: "user",
            userId: actingUserId,
          }),
        },
        select: { id: true, name: true },
      });
      if (taskSched) {
        const rightTool =
          params.capability === "delete_schedule"
            ? "delete_task_schedule"
            : "save_task_schedule";
        throw new SokoBotRefusedUnsentError(
          `Schedule "${taskSched.name}" (${taskSched.id}) is a Task Schedule, not a bot follow-up schedule. Use ${rightTool} instead.`,
        );
      }
    }
    return { scheduleId: params.scheduleId };
  }

  const trimmedName = params.scheduleName?.trim();
  if (!trimmedName) return {};
  const wantedLower = trimmedName.toLowerCase();

  const disallowBuiltIns =
    params.capability === "delete_schedule" ||
    Boolean(params.changesPromptOrName);

  const exactMatches = activeSchedules.filter(
    (row) => row.name.trim().toLowerCase() === wantedLower,
  );
  if (exactMatches.length === 1) {
    const target = exactMatches[0]!;
    if (disallowBuiltIns && target.systemKey !== null) {
      const customCount = activeSchedules.filter(
        (row) => row.systemKey === null,
      ).length;
      throw new SokoBotRefusedUnsentError(
        `"${target.name}" is a built-in rhythm: only its time, timezone, and on/off change (${customCount} custom schedule(s) exist). Call create_schedule to create a new custom schedule instead.`,
      );
    }
    return {
      scheduleId: target.id,
      resolvedTarget: {
        kind: "schedule",
        id: target.id,
        label: target.name,
        autoResolved: false,
        reason: `Exact match for schedule "${target.name}".`,
      },
    };
  }
  if (exactMatches.length > 1) {
    throw new SokoBotRefusedUnsentError(
      `Multiple schedules are named "${trimmedName}": ${exactMatches.map((s) => `${s.name} (${s.id})`).join("; ")}. Pass scheduleId to pick one.`,
    );
  }

  const pool = disallowBuiltIns
    ? activeSchedules.filter((row) => row.systemKey === null)
    : activeSchedules;

  const queryTokens = wantedLower
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const partialMatches = pool.filter((row) => {
    const candidateName = row.name.trim();
    if (containsExactName(candidateName, trimmedName)) return true;
    if (queryTokens.length === 0) return false;
    return queryTokens.every((token) =>
      containsExactName(candidateName, token),
    );
  });

  if (partialMatches.length === 1) {
    const target = partialMatches[0]!;
    return {
      scheduleId: target.id,
      resolvedTarget: {
        kind: "schedule",
        id: target.id,
        label: target.name,
        autoResolved: true,
        reason: `Uniquely matched custom schedule "${target.name}".`,
      },
    };
  }
  if (partialMatches.length > 1) {
    throw new SokoBotRefusedUnsentError(
      `Schedule name "${trimmedName}" matches multiple schedules: ${partialMatches.map((s) => `${s.name} (${s.id})`).join("; ")}. Pass scheduleId or ask the owner once which schedule to change.`,
    );
  }

  if (disallowBuiltIns && pool.length === 0) {
    const builtIns = activeSchedules.filter((row) => row.systemKey !== null);
    if (builtIns.length > 0) {
      throw new SokoBotRefusedUnsentError(
        `No custom schedule matches "${trimmedName}" (0 custom schedules exist; built-in rhythms cannot have their prompt or name changed or be deleted). Call create_schedule to create a new custom schedule instead.`,
      );
    }
  }

  return {};
}

/**
 * Guard for `save_task_schedule` / `delete_task_schedule`: detects when the
 * model passed one of its own `SokoBotSchedule` UUIDs instead of a Task Schedule.
 */
export async function checkTaskScheduleIdNotBotSchedule(
  authorized: AuthorizedSokoBotRuntime,
  scheduleId: string,
  capability: "save_task_schedule" | "delete_task_schedule",
): Promise<void> {
  if (!isTargetResolverEnabled(authorized.turn.versionId)) return;
  const botSchedule = await prisma.sokoBotSchedule.findFirst({
    where: {
      id: scheduleId,
      sokoBotId: authorized.turn.sokoBotId,
    },
    select: { id: true, name: true },
  });
  if (botSchedule) {
    const rightTool =
      capability === "delete_task_schedule"
        ? "delete_schedule"
        : "update_schedule";
    throw new SokoBotRefusedUnsentError(
      `Schedule "${botSchedule.name}" (${botSchedule.id}) is a bot follow-up schedule, not a Task Schedule. Use ${rightTool} instead.`,
    );
  }
}

export interface SocialAccountTargetResolutionEntry {
  count: number;
  status: "missing" | "only_candidate" | "ambiguous";
  note: string;
  onlyCandidate?: {
    socialConnectionId: string;
    handle: string | null;
    projectId: string;
    projectName: string;
  };
  candidates?: Array<{
    socialConnectionId: string;
    handle: string | null;
    projectId: string;
    projectName: string;
  }>;
}

/**
 * List-tool target annotation for `list_project_social_accounts` (E10).
 * - Personal bots (`sharedScope === null`): inspects active connections across
 *   open workspace projects so a bot reading one project immediately sees when
 *   another project holds a second account for the same network.
 * - Shared bots (`sharedScope !== null`): stays strictly confined to `projectId`.
 */
export async function buildSocialAccountsTargetResolution(
  authorized: AuthorizedSokoBotRuntime,
  projectId: string,
  projectAccounts: ReadonlyArray<{
    id: string;
    provider: string;
    status: string;
    externalHandle: string | null;
  }>,
): Promise<Record<string, SocialAccountTargetResolutionEntry>> {
  const botProjectId = scopedBotProjectId(authorized);
  const scopeWhere = openProjectWhere(
    authorized.turn.workspaceId,
    botProjectId ?? null,
  );
  const active = botProjectId
    ? await (async () => {
        const projectRow = await prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, name: true },
        });
        const projectName = projectRow?.name ?? "Project";
        return projectAccounts
          .filter((account) => account.status === "active")
          .map((account) => ({
            id: account.id,
            provider: account.provider,
            externalHandle: account.externalHandle,
            project: { id: projectId, name: projectName },
          }));
      })()
    : await prisma.projectSocialConnection.findMany({
        where: {
          status: "active",
          project: scopeWhere,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          provider: true,
          externalHandle: true,
          project: { select: { id: true, name: true } },
        },
      });

  const byProvider = new Map<string, typeof active>();
  for (const row of active) {
    const existing = byProvider.get(row.provider) ?? [];
    existing.push(row);
    byProvider.set(row.provider, existing);
  }

  const summary: Record<string, SocialAccountTargetResolutionEntry> = {};
  for (const [provider, rows] of byProvider.entries()) {
    const label = socialPostProviderLabel(provider as SocialPostProvider);
    const scopeText = botProjectId ? "on this project" : "in your workspace";
    if (rows.length === 1) {
      const only = rows[0]!;
      const handle = socialHandleOf(only);
      summary[provider] = {
        count: 1,
        status: "only_candidate",
        onlyCandidate: {
          socialConnectionId: only.id,
          handle: handle ? `@${handle}` : null,
          projectId: only.project.id,
          projectName: only.project.name,
        },
        note: `Only active ${label} account ${scopeText} (${socialDestinationLabel(only)}). Use it directly without asking which project or account, and state which one you used in one line.`,
      };
    } else {
      summary[provider] = {
        count: rows.length,
        status: "ambiguous",
        candidates: rows.slice(0, MAX_SHOWN_CANDIDATES).map((row) => {
          const handle = socialHandleOf(row);
          return {
            socialConnectionId: row.id,
            handle: handle ? `@${handle}` : null,
            projectId: row.project.id,
            projectName: row.project.name,
          };
        }),
        note: `${rows.length} active ${label} accounts exist ${scopeText}: ${formatCapped(rows, socialDestinationLabel)}. Unless the owner named one, ask once before drafting and make no social changes until they answer.`,
      };
    }
  }
  return summary;
}

/** List-tool target annotation for `list_social_posts` (E10). */
export function buildSocialPostsTargetResolution(
  projectId: string,
  posts: ReadonlyArray<{ id: string; status: string; revision: number }>,
) {
  const editable = posts.filter((post) =>
    EDITABLE_POST_STATUSES.has(post.status),
  );
  if (editable.length === 0) {
    return {
      editableCount: 0,
      status: "missing" as const,
      note: "No editable social posts matched in this project.",
    };
  }
  if (editable.length === 1) {
    const only = editable[0]!;
    return {
      editableCount: 1,
      status: "only_candidate" as const,
      onlyCandidate: {
        postId: only.id,
        revision: only.revision,
        status: only.status,
        projectId,
      },
      note: `Only 1 editable post matched (postId ${only.id}, status ${only.status}, revision ${only.revision}). Update or cancel it directly without asking which post.`,
    };
  }
  return {
    editableCount: editable.length,
    status: "ambiguous" as const,
    note: `${editable.length} editable posts matched. Act only on the post(s) the owner identified, or ask once if it is unclear which post to change.`,
  };
}

/** List-tool target annotation for `list_schedules` (E10). */
export function buildSchedulesTargetResolution(input: {
  botSchedules: ReadonlyArray<{
    id: string;
    name: string;
    createdBy: string;
    youCanChange: boolean;
  }>;
  taskSchedules?: ReadonlyArray<{
    id: string;
    name: string;
    youCanChange?: boolean;
  }>;
}) {
  const editableCustomBot = input.botSchedules.filter(
    (schedule) =>
      schedule.youCanChange && schedule.createdBy !== "built-in rhythm",
  );
  const builtInRhythms = input.botSchedules.filter(
    (schedule) => schedule.createdBy === "built-in rhythm",
  );
  const editableTasks = (input.taskSchedules ?? []).filter(
    (schedule) => schedule.youCanChange !== false,
  );
  const totalEditable = editableCustomBot.length + editableTasks.length;

  if (totalEditable === 0) {
    return {
      editableCustomBotCount: 0,
      editableTaskScheduleCount: 0,
      builtInRhythmCount: builtInRhythms.length,
      status: "missing_custom" as const,
      note:
        builtInRhythms.length > 0
          ? `0 custom schedules exist (${builtInRhythms.length} built-in rhythm(s) cannot have their prompt or name changed or be deleted). Use create_schedule or save_task_schedule to create a new schedule instead of editing a built-in rhythm.`
          : "0 editable schedules exist in this view.",
    };
  }
  if (editableCustomBot.length === 1 && editableTasks.length === 0) {
    const only = editableCustomBot[0]!;
    return {
      editableCustomBotCount: 1,
      editableTaskScheduleCount: 0,
      builtInRhythmCount: builtInRhythms.length,
      status: "only_candidate" as const,
      onlyCandidate: {
        kind: "bot_schedule" as const,
        scheduleId: only.id,
        name: only.name,
      },
      note: `Only 1 editable custom bot schedule exists ("${only.name}", scheduleId ${only.id}). Address it by scheduleId without asking which schedule.`,
    };
  }
  if (editableCustomBot.length === 0 && editableTasks.length === 1) {
    const only = editableTasks[0]!;
    return {
      editableCustomBotCount: 0,
      editableTaskScheduleCount: 1,
      builtInRhythmCount: builtInRhythms.length,
      status: "only_candidate" as const,
      onlyCandidate: {
        kind: "task_schedule" as const,
        scheduleId: only.id,
        name: only.name,
      },
      note: `Only 1 editable Task Schedule exists ("${only.name}", scheduleId ${only.id}). Address it by scheduleId with save_task_schedule / delete_task_schedule without asking which schedule.`,
    };
  }
  return {
    editableCustomBotCount: editableCustomBot.length,
    editableTaskScheduleCount: editableTasks.length,
    builtInRhythmCount: builtInRhythms.length,
    status: "ambiguous" as const,
    note: `${totalEditable} editable custom schedules exist (${editableCustomBot.length} bot, ${editableTasks.length} Task Schedules). Match the schedule the owner named by scheduleId, or ask once if ambiguous.`,
  };
}
