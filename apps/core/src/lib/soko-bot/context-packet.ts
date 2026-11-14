import { createHash } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import type {
  SokoBotContextPacket,
  TurnClassification,
} from "@sokosumi/soko-bot";
import { convertCentsToCredits } from "@sokosumi/utils";
import { taskOwnerLabel } from "@/helpers/soko-bot-owner";
import { buildCreditsPayload } from "@/helpers/subscription";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import { evalHistoryFloor } from "@/lib/evals/eval-history";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import {
  compactBrandBrain,
  getBrandBrain,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { listHireableAgents } from "./agent-search";
import {
  actorLocale,
  actorTimezone,
  boundedIdentifier,
  type ContextPacketWithoutHash,
  FINISHED_TASK_WINDOW_MS,
  finiteNonNegative,
  fitPacketToBudget,
  LIMITS,
  MARKETPLACE_ROUTES,
  OFF_TOPIC_TASKS,
  projectStatus,
  sanitizeMemory,
  sanitizeStringList,
  sanitizeText,
  TEXT_LIMITS,
  triggerHints,
  UNLIKELY_SIGNAL,
} from "./context-packet-format";
import {
  type ContextPacketReaderInput,
  contextPacketScope,
} from "./context-packet-scope";

export interface BuildContextPacketInput extends ContextPacketReaderInput {
  source: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT" | "INGEST";
  /** Tells a CMO rhythm or production run (approved strategy) from other turns. */
  clientTurnId?: string;
  classification: TurnClassification;
  referencedTaskIds?: readonly string[];
  /** A person typed this turn: it holds every tool, and the route is a guess. */
  personAsked?: boolean;
  /** The lasting preference saved from this message before the turn. */
  capturedPreference?: string | null;
}

export interface BuiltContextPacket {
  packet: SokoBotContextPacket;
  byteSize: number;
  tokenEstimate: number;
  counts: Record<string, number>;
  omissions: Record<string, number>;
}

export class ContextPacketBuilder {
  async build(input: BuildContextPacketInput): Promise<BuiltContextPacket> {
    const workspace = await prisma.workspace.findFirst({
      // A shared bot acting on its own reads its own workspace, which
      // resolving the bot already proved.
      where:
        input.userId === null
          ? { id: input.workspaceId }
          : {
              id: input.workspaceId,
              OR: [
                { userId: input.userId },
                {
                  organization: {
                    members: { some: { userId: input.userId } },
                  },
                },
              ],
            },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
            members: {
              where: { userId: input.userId ?? undefined },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!workspace) throw new Error("Workspace is not accessible");

    const organizationId = workspace.organizationId;
    // Cuso (CMO) reads its Brand Brain and strategy here on every turn; null
    // for every other bot. A teammate's question never sees the plan, and a
    // failed read leaves the plan out rather than failing the turn.
    const marketing =
      input.audience === "TEAMMATE"
        ? null
        : await Promise.all([
            import("@/services/cmo-context.service"),
            import("@/services/cmo-strategy.service"),
          ])
            .then(([{ loadCmoMarketingContext }, { cmoTurnExecutesPlan }]) =>
              loadCmoMarketingContext(input.sokoBotId, undefined, {
                executing: cmoTurnExecutesPlan({
                  source: input.source,
                  clientTurnId: input.clientTurnId ?? null,
                }),
              }),
            )
            .catch(() => null);
    // Every bot of a Project reads its Brand Brain (ADR 0062); Cuso already
    // has it in his marketing packet. A failed read leaves it out.
    const brandBrainProjectId = input.sharedScope?.projectId ?? null;
    const brandBrain =
      marketing || !brandBrainProjectId
        ? null
        : await getBrandBrain(brandBrainProjectId)
            .then((row) => compactBrandBrain(parseBrandBrain(row?.body)))
            .catch(() => null);
    const referenceId = organizationId ?? input.userId;
    // Only a shared bot acts for nobody, and only in an Organization.
    if (referenceId === null) throw new Error("Workspace is not accessible");
    const billingPromise = buildCreditsPayload({
      userId: input.userId,
      organizationId,
      referenceId,
      // The bot's Project (Cuso's): its Project credits count (ADR 0067).
      projectId: input.sharedScope?.projectId,
      tx: prisma,
    });
    // Only routes that can hire carry the marketplace; the count still goes in.
    const hiring = MARKETPLACE_ROUTES.has(input.classification.route);
    const agentsPromise = listHireableAgents(hiring ? LIMITS.agents : 0);

    const scope = contextPacketScope(input);
    const { askedByKind } = scope;
    const [historyFloor, newsletterEnabled] = await Promise.all([
      evalHistoryFloor(input),
      isNewsletterWorkspaceEnabled(input.workspaceId),
    ]);
    const recentTurnWhere = {
      ...scope.recentTurnWhere,
      ...(historyFloor ? { createdAt: { gte: historyFloor } } : {}),
    };
    // The bot can list Tasks itself; a message about something else leaves
    // their room to the conversation.
    const taskLimit =
      input.personAsked &&
      (input.classification.signals?.aboutTasks ?? 1) < UNLIKELY_SIGNAL
        ? OFF_TOPIC_TASKS
        : LIMITS.tasks;
    const globalCoworkers = await globalCoworkersFor(input.workspaceId);
    const [
      user,
      projects,
      tasks,
      coworkers,
      agentRead,
      jobs,
      pendingDecisions,
      recentTurns,
      memoryRevision,
      billing,
      projectCount,
      taskCount,
      coworkerCount,
      jobCount,
      pendingDecisionCount,
      recentTurnCount,
      asker,
    ] = await Promise.all([
      input.userId === null
        ? null
        : prisma.user.findUniqueOrThrow({
            where: { id: input.userId },
            select: { id: true, name: true, metadata: true },
          }),
      prisma.project.findMany({
        where: scope.projectWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIMITS.projects,
        select: {
          id: true,
          name: true,
          briefing: true,
          newsletter: {
            where: { workspaceId: input.workspaceId },
            select: { id: true },
          },
          updatedAt: true,
          _count: {
            select: {
              tasks: { where: { archivedAt: null, ...scope.taskWhere } },
              jobs: { where: scope.jobWhere },
            },
          },
        },
      }),
      // Named Tasks first, then open work, then what finished this week.
      Promise.all(
        [
          ...(input.referencedTaskIds?.length
            ? [
                {
                  where: { id: { in: [...input.referencedTaskIds] } },
                  take: taskLimit,
                },
              ]
            : []),
          {
            where: { status: { notIn: [...SETTLED_TASK_STATUSES] } },
            take: Math.max(taskLimit - LIMITS.finishedTasks, 1),
          },
          {
            where: {
              status: { in: [...SETTLED_TASK_STATUSES] },
              updatedAt: {
                gte: new Date(Date.now() - FINISHED_TASK_WINDOW_MS),
              },
            },
            take: LIMITS.finishedTasks,
          },
        ].map((page: { where: Prisma.TaskWhereInput; take: number }) =>
          prisma.task.findMany({
            where: {
              ...page.where,
              workspaceId: input.workspaceId,
              archivedAt: null,
              ...scope.taskWhere,
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: page.take,
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              ownerId: true,
              owner: { select: { name: true } },
              projectId: true,
              assigneeId: true,
              assigneeSokoBotId: true,
              runAt: true,
              scheduleId: true,
              updatedAt: true,
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { status: true, comment: true, createdAt: true },
              },
              linksTo: {
                where: {
                  type: "BLOCKS",
                  fromTask: {
                    workspaceId: input.workspaceId,
                    archivedAt: null,
                    ...scope.taskWhere,
                  },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: LIMITS.blockersPerTask,
                select: {
                  fromTask: {
                    select: { id: true, name: true, status: true },
                  },
                },
              },
              _count: {
                select: {
                  linksTo: {
                    where: {
                      type: "BLOCKS",
                      fromTask: {
                        workspaceId: input.workspaceId,
                        archivedAt: null,
                        ...scope.taskWhere,
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
      ).then((pages) =>
        [
          ...new Map(pages.flat().map((task) => [task.id, task])).values(),
        ].slice(0, taskLimit),
      ),
      prisma.coworker.findMany({
        where: {
          archivedAt: null,
          OR: [
            ...globalCoworkers,
            { assignments: { some: scope.coworkerAssignmentWhere } },
            {
              workspaceAccess: {
                some: { workspaceId: input.workspaceId, status: "GRANTED" },
              },
            },
          ],
        },
        orderBy: [{ priority: "desc" }, { name: "asc" }, { id: "asc" }],
        take: LIMITS.coworkers,
        select: {
          id: true,
          name: true,
          caption: true,
          description: true,
          capabilities: true,
          isWhitelisted: true,
          assignments: {
            where: scope.coworkerAssignmentWhere,
            select: { id: true },
            take: 1,
          },
          workspaceAccess: {
            where: { workspaceId: input.workspaceId },
            select: { status: true },
            take: 1,
          },
          vendor: {
            select: {
              vendorGrants: {
                where: { workspaceId: input.workspaceId },
                select: { status: true },
                take: 1,
              },
            },
          },
        },
      }),
      agentsPromise,
      prisma.job.findMany({
        where: { ...scope.jobWhere, workspaceId: input.workspaceId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIMITS.jobs,
        select: {
          id: true,
          name: true,
          agentId: true,
          jobType: true,
          projectId: true,
          updatedAt: true,
          transaction: { select: { amount: true } },
          events: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { status: true, inputSchema: true, createdAt: true },
          },
        },
      }),
      prisma.sokoBotPendingDecision.findMany({
        where: scope.pendingDecisionWhere(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIMITS.pendingDecisions,
        select: {
          id: true,
          toolName: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      prisma.sokoBotTurn.findMany({
        where: recentTurnWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIMITS.recentTurns,
        select: {
          id: true,
          source: true,
          status: true,
          route: true,
          userMessage: true,
          finalAnswer: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.sokoBotMemoryRevision.findFirst({
        where: scope.memoryWhere,
        orderBy: { version: "desc" },
        select: { id: true, version: true, hash: true, markdown: true },
      }),
      billingPromise,
      prisma.project.count({ where: scope.projectWhere }),
      prisma.task.count({
        where: {
          workspaceId: input.workspaceId,
          archivedAt: null,
          ...scope.taskWhere,
        },
      }),
      prisma.coworker.count({
        where: {
          archivedAt: null,
          OR: [
            ...globalCoworkers,
            { assignments: { some: scope.coworkerAssignmentWhere } },
            {
              workspaceAccess: {
                some: { workspaceId: input.workspaceId, status: "GRANTED" },
              },
            },
          ],
        },
      }),
      prisma.job.count({
        where: { ...scope.jobWhere, workspaceId: input.workspaceId },
      }),
      prisma.sokoBotPendingDecision.count({
        where: scope.pendingDecisionWhere(),
      }),
      prisma.sokoBotTurn.count({ where: recentTurnWhere }),
      scope.askerUserId
        ? prisma.user.findUnique({
            where: { id: scope.askerUserId },
            select: { name: true },
          })
        : null,
    ]);

    const namedOnly =
      projectCount > projects.length
        ? await prisma.project.findMany({
            where: {
              AND: [
                scope.projectWhere,
                { id: { notIn: projects.map((project) => project.id) } },
              ],
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: LIMITS.projectNames,
            select: {
              id: true,
              name: true,
              newsletter: {
                where: { workspaceId: input.workspaceId },
                select: { id: true },
              },
            },
          })
        : [];

    const reminders = !scope.includeReminders
      ? []
      : await prisma.sokoBotNudge.findMany({
          where: {
            sokoBotId: input.sokoBotId,
            state: { in: ["ACTIVE", "ACKNOWLEDGED", "SNOOZED"] },
          },
          orderBy: [{ lastAt: "desc" }, { id: "desc" }],
          take: 12,
          select: {
            key: true,
            state: true,
            revision: true,
            snoozedUntil: true,
            expiresAt: true,
            lastDeliveredAt: true,
          },
        });
    const { agents, count: agentCount } = agentRead;
    const counts = {
      projects: projectCount,
      tasks: taskCount,
      coworkers: coworkerCount,
      agents: agentCount,
      jobs: jobCount,
      pendingDecisions: pendingDecisionCount,
      recentTurns: recentTurnCount,
    };
    const generatedAt = new Date().toISOString();
    const safeMemoryMarkdown = sanitizeMemory(
      memoryRevision?.markdown ?? "# Soko Bot memory",
    );
    const hints = triggerHints(input);
    const packetWithoutHash: ContextPacketWithoutHash = {
      schemaVersion: 1,
      generatedAt,
      trigger: {
        source: input.source,
        route: input.classification.route,
        confidence: input.classification.confidence,
        ...(input.classification.unsureRoute
          ? { unsureRoute: input.classification.unsureRoute }
          : {}),
        ...(hints.length ? { hints } : {}),
        requestedOutcome:
          sanitizeText(
            input.classification.requestedOutcome,
            TEXT_LIMITS.requestedOutcome,
          ) ?? "",
        // Who is on the other side of this turn. `actor` below is the owner
        // whatever happens, so this is the only field that distinguishes the
        // owner asking, a colleague asking in a shared room, and another
        // assistant asking on its own owner's behalf.
        askedBy: {
          kind: askedByKind,
          // Only an OWNER turn may borrow the owner's name. A colleague whose
          // account has since been deleted has no name to give, and falling
          // back to the owner's would say the owner is the one asking — the
          // exact confusion this field exists to end.
          name:
            askedByKind === "OWNER"
              ? sanitizeText(user?.name ?? null, TEXT_LIMITS.actorName)
              : asker
                ? sanitizeText(asker.name, TEXT_LIMITS.actorName)
                : null,
          trust: "untrusted-data",
        },
      },
      actor: {
        // Null when a shared bot acts on its own: nobody is behind the turn.
        id: boundedIdentifier(user?.id ?? null),
        name: sanitizeText(user?.name ?? null, TEXT_LIMITS.actorName),
        locale: actorLocale(user?.metadata ?? null),
        timezone: actorTimezone(user?.metadata ?? null),
        workspaceId: boundedIdentifier(workspace.id),
        organizationId: boundedIdentifier(workspace.organizationId),
        organizationName: sanitizeText(
          workspace.organization?.name ?? null,
          TEXT_LIMITS.organizationName,
        ),
        role:
          user === null
            ? null
            : (sanitizeText(
                workspace.organization?.members[0]?.role ?? "owner",
                TEXT_LIMITS.role,
              ) ?? "owner"),
        trust: "untrusted-data",
      },
      workspace: {
        reminders,
        ...(marketing ? { marketing } : {}),
        id: boundedIdentifier(workspace.id),
        scope: organizationId ? "organization" : "personal",
        plan: sanitizeText(
          billing.subscription?.plan ??
            (billing.enterprise ? "enterprise" : "free"),
          TEXT_LIMITS.billingLabel,
        ),
        subscriptionStatus: sanitizeText(
          billing.subscription?.status ?? null,
          TEXT_LIMITS.billingLabel,
        ),
        availableCredits: finiteNonNegative(billing.spendable),
        bufferCredits: finiteNonNegative(billing.extra.credits.remaining),
        subscriptionRemainingCredits: finiteNonNegative(
          billing.subscription?.credits?.remaining,
        ),
        enterpriseRemainingCredits: finiteNonNegative(
          billing.enterprise?.credits.remaining,
        ),
      },
      projects: [
        ...projects.map((project) => ({
          id: boundedIdentifier(project.id),
          name: sanitizeText(project.name, TEXT_LIMITS.name),
          summary: sanitizeText(project.briefing, TEXT_LIMITS.summary),
          newsletter: {
            configured: !!project.newsletter,
            available: newsletterEnabled && !!project.newsletter,
          },
          status: projectStatus(
            project.id,
            project._count.tasks,
            project._count.jobs,
            tasks,
            jobs,
          ),
          updatedAt: project.updatedAt.toISOString(),
          ...(brandBrain && project.id === brandBrainProjectId
            ? { brandBrain }
            : {}),
          trust: "untrusted-data",
        })),
        // Name only: enough to find a Project the owner names.
        ...namedOnly.map((project) => ({
          id: boundedIdentifier(project.id),
          name: sanitizeText(project.name, TEXT_LIMITS.name),
          newsletter: {
            configured: !!project.newsletter,
            available: newsletterEnabled && !!project.newsletter,
          },
          trust: "untrusted-data",
        })),
      ],
      tasks: tasks.map((task) => ({
        requiredReference: input.referencedTaskIds?.includes(task.id) ?? false,
        id: boundedIdentifier(task.id),
        name: sanitizeText(task.name, TEXT_LIMITS.name),
        summary: sanitizeText(task.description, TEXT_LIMITS.summary),
        status: task.status,
        owner: taskOwnerLabel(task, input.userId),
        priority: null,
        dueAt: null,
        runAt: task.runAt?.toISOString() ?? null,
        scheduleId: boundedIdentifier(task.scheduleId),
        projectId: boundedIdentifier(task.projectId),
        coworkerId: boundedIdentifier(task.assigneeId),
        assigneeSokoBotId: boundedIdentifier(task.assigneeSokoBotId),
        blockedBy: task.linksTo.map((link) => ({
          id: boundedIdentifier(link.fromTask.id),
          name: sanitizeText(link.fromTask.name, TEXT_LIMITS.name),
          status: link.fromTask.status,
          trust: "untrusted-data",
        })),
        blockersOmitted: Math.max(0, task._count.linksTo - task.linksTo.length),
        lastEvent: task.events[0]
          ? {
              status: task.events[0].status,
              summary: sanitizeText(
                task.events[0].comment,
                TEXT_LIMITS.eventSummary,
              ),
              at: task.events[0].createdAt.toISOString(),
            }
          : null,
        updatedAt: task.updatedAt.toISOString(),
        trust: "untrusted-data",
      })),
      coworkers: coworkers.map((coworker) => ({
        id: boundedIdentifier(coworker.id),
        name: sanitizeText(coworker.name, TEXT_LIMITS.name),
        caption: sanitizeText(coworker.caption, TEXT_LIMITS.caption),
        summary: sanitizeText(coworker.description, TEXT_LIMITS.summary),
        capabilities: sanitizeStringList(
          coworker.capabilities,
          LIMITS.coworkerCapabilities,
          TEXT_LIMITS.capability,
        ),
        availability: {
          available: true,
          globallyAvailable: coworker.isWhitelisted,
          assignedToUser: coworker.assignments.length > 0,
          workspaceAccessStatus: coworker.workspaceAccess[0]?.status ?? null,
        },
        vendorGrantStatus:
          coworker.vendor.vendorGrants[0]?.status ?? "NOT_REQUESTED",
        pricing: null,
        trust: "untrusted-data",
      })),
      agents: (hiring ? agents : []).map((agent) => ({
        id: boundedIdentifier(agent.id),
        name: sanitizeText(agent.name, TEXT_LIMITS.name),
        summary: sanitizeText(
          agent.summary ?? agent.description,
          TEXT_LIMITS.summary,
        ),
        capability: sanitizeText(agent.capabilityName, TEXT_LIMITS.capability),
        inputRequirements: {
          source: "fetch-required",
          availableInContext: false,
        },
        price: agent.price,
        paymentType: agent.paymentType,
        riskClassification: agent.riskClassification,
        trust: "untrusted-data",
      })),
      jobs: jobs.map((job) => {
        const latestEvent = job.events[0];
        return {
          id: boundedIdentifier(job.id),
          name: sanitizeText(job.name, TEXT_LIMITS.name),
          agentId: boundedIdentifier(job.agentId),
          jobType: job.jobType,
          projectId: boundedIdentifier(job.projectId),
          status: latestEvent?.status ?? null,
          pendingInput:
            latestEvent?.status === "AWAITING_INPUT"
              ? {
                  required: true,
                  schema: sanitizeText(
                    latestEvent.inputSchema,
                    TEXT_LIMITS.inputSchema,
                  ),
                }
              : null,
          spentCredits: job.transaction
            ? Math.abs(convertCentsToCredits(job.transaction.amount))
            : 0,
          updatedAt: job.updatedAt.toISOString(),
          trust: "untrusted-data",
        };
      }),
      pendingDecisions: pendingDecisions.map((decision) => ({
        id: boundedIdentifier(decision.id),
        toolName: sanitizeText(decision.toolName, TEXT_LIMITS.capability),
        reason: sanitizeText(decision.reason, TEXT_LIMITS.decisionReason),
        expiresAt: decision.expiresAt.toISOString(),
        createdAt: decision.createdAt.toISOString(),
        trust: "untrusted-data",
      })),
      recentTurns: [...recentTurns].reverse().map((turn, index, turns) => ({
        id: boundedIdentifier(turn.id),
        source: turn.source,
        status: turn.status,
        route: turn.route,
        // A self-started turn's message is Core's prompt, not the owner's:
        // its first words say what kind of post it was, the rest is noise.
        userMessage: sanitizeText(
          turn.userMessage,
          turn.source === "CHAT"
            ? TEXT_LIMITS.turnMessage
            : TEXT_LIMITS.selfStartedTurnMessage,
        ),
        finalAnswer: sanitizeText(
          turn.finalAnswer,
          index === turns.length - 1
            ? TEXT_LIMITS.latestTurnAnswer
            : TEXT_LIMITS.turnAnswer,
        ),
        createdAt: turn.createdAt.toISOString(),
        completedAt: turn.completedAt?.toISOString() ?? null,
        trust: "untrusted-data",
      })),
      memory: {
        version: memoryRevision?.version ?? 0,
        hash: createHash("sha256").update(safeMemoryMarkdown).digest("hex"),
        markdown: safeMemoryMarkdown,
      },
      counts,
      omissions: {},
    };
    const fitted = fitPacketToBudget(packetWithoutHash, counts);

    return {
      packet: fitted.packet,
      byteSize: fitted.byteSize,
      tokenEstimate: Math.ceil(fitted.byteSize / 4),
      counts,
      omissions: fitted.omissions,
    };
  }
}
