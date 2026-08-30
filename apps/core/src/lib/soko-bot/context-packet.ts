import { createHash } from "node:crypto";
import type { CreditCost } from "@sokosumi/database";
import type {
  SokoBotContextPacket,
  TurnClassification,
} from "@sokosumi/soko-bot";
import {
  redactSokoBotSensitiveText,
  sanitizeSokoBotMemoryMarkdown,
} from "@sokosumi/soko-bot";
import { convertCentsToCredits } from "@sokosumi/utils";

import { AGENT_PRICING_READ_TRANSACTION_OPTIONS } from "@/helpers/agent";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";

const LIMITS = {
  projects: 12,
  tasks: 24,
  blockersPerTask: 5,
  coworkers: 24,
  coworkerCapabilities: 12,
  agents: 24,
  jobs: 24,
  pendingDecisions: 12,
  recentTurns: 12,
} as const;

const TEXT_LIMITS = {
  identifier: 128,
  actorName: 120,
  locale: 35,
  timezone: 100,
  organizationName: 120,
  role: 40,
  billingLabel: 80,
  requestedOutcome: 1_000,
  name: 160,
  caption: 240,
  summary: 500,
  eventSummary: 300,
  capability: 120,
  inputSchema: 1_000,
  decisionReason: 300,
  turnMessage: 1_000,
  turnAnswer: 2_000,
  memoryBytes: 8_192,
} as const;

export const SOKO_BOT_CONTEXT_PACKET_MAX_BYTES = 48 * 1_024;

const PACKET_COLLECTION_KEYS = [
  "agents",
  "coworkers",
  "jobs",
  "tasks",
  "projects",
  "pendingDecisions",
  "recentTurns",
] as const satisfies readonly (keyof typeof LIMITS)[];

type ContextPacketWithoutHash = Omit<SokoBotContextPacket, "hash">;
type PacketCollectionKey = (typeof PACKET_COLLECTION_KEYS)[number];

interface ProjectStatusTask {
  projectId: string | null;
  status: string;
}

interface ProjectStatusJob {
  projectId: string | null;
  events: readonly { status: string }[];
}

interface AgentPricingRow {
  pricingType: string;
  fixedPricing: {
    amounts: readonly { amount: bigint; unit: string }[];
  } | null;
}

/**
 * Strips the owner's private surfaces from an assembled packet. Workspace
 * projects, tasks, and jobs stay: every member of that workspace can already
 * see them. Durable memory, prior turns, the owner's approval queue, and their
 * credit balance cannot be published into a shared room.
 */
function redactForTeammate(
  packet: ContextPacketWithoutHash,
): ContextPacketWithoutHash {
  return {
    ...packet,
    workspace: {
      ...packet.workspace,
      plan: null,
      subscriptionStatus: null,
      availableCredits: null,
      bufferCredits: null,
      subscriptionRemainingCredits: null,
      enterpriseRemainingCredits: null,
    },
    pendingDecisions: [],
    recentTurns: [],
    memory: { version: 0, hash: null, markdown: "# Soko Bot memory" },
  };
}

export interface BuildContextPacketInput {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
  source: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT" | "INGEST";
  classification: TurnClassification;
  /**
   * Who the turn answers. A teammate mentioning someone else's bot in a shared
   * room receives the model's answer in that room, so the packet must not carry
   * the owner's private surfaces even though the turn runs as the owner.
   */
  audience?: "OWNER" | "TEAMMATE";
  /**
   * Who is on the other side of this turn. The turn runs as the owner — their
   * bot, their credits — so `actor` is always the owner, and without this the
   * packet asserts the owner is the one speaking: a bot reading that greets
   * its owner by name at a teammate.
   *
   * `ASSISTANT` is another bot asking, and is deliberately nameless. The id
   * that reaches us then belongs to the *sending bot's owner*, who is not in
   * the conversation at all, so naming them would be worse than saying
   * nothing.
   */
  askedByKind?: "OWNER" | "TEAMMATE" | "ASSISTANT";
  askedByUserId?: string | null;
}

export interface BuiltContextPacket {
  packet: SokoBotContextPacket;
  byteSize: number;
  tokenEstimate: number;
  counts: Record<string, number>;
  omissions: Record<string, number>;
}

function sanitizeText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return redactSokoBotSensitiveText(value)
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  let truncated = value.slice(0, low);
  if (/^[\uDC00-\uDFFF]/.test(value.slice(low, low + 1))) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

function sanitizeMemory(value: string): string {
  const normalized = sanitizeSokoBotMemoryMarkdown(value)
    .replaceAll(/\r\n?/g, "\n")
    .trim();
  return truncateUtf8(normalized, TEXT_LIMITS.memoryBytes);
}

function boundedIdentifier(value: string | null): string | null {
  return sanitizeText(value, TEXT_LIMITS.identifier);
}

function readMetadataString(
  metadata: string | null,
  keys: readonly string[],
): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function actorLocale(metadata: string | null): string | null {
  const locale = sanitizeText(
    readMetadataString(metadata, ["locale"]),
    TEXT_LIMITS.locale,
  );
  return locale && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale)
    ? locale
    : null;
}

function actorTimezone(metadata: string | null): string | null {
  const timezone = sanitizeText(
    readMetadataString(metadata, ["timezone", "timeZone"]),
    TEXT_LIMITS.timezone,
  );
  if (!timezone || !/^[a-z0-9_+.-]+(?:\/[a-z0-9_+.-]+)*$/i.test(timezone)) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

function sanitizeStringList(
  values: readonly string[],
  limit: number,
  maxLength: number,
): string[] {
  return values
    .slice(0, limit)
    .map((value) => sanitizeText(value, maxLength))
    .filter((value): value is string => Boolean(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function hashPacket(packet: ContextPacketWithoutHash): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(packet)))
    .digest("hex");
}

function countStatuses(statuses: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function projectStatus(
  projectId: string,
  totalTasks: number,
  totalJobs: number,
  tasks: readonly ProjectStatusTask[],
  jobs: readonly ProjectStatusJob[],
) {
  const taskStatuses = tasks
    .filter((task) => task.projectId === projectId)
    .map((task) => task.status);
  const jobStatuses = jobs
    .filter((job) => job.projectId === projectId)
    .map((job) => job.events[0]?.status)
    .filter((status): status is string => Boolean(status));

  return {
    taskCounts: countStatuses(taskStatuses),
    jobCounts: countStatuses(jobStatuses),
    totalTasks,
    totalJobs,
    partial: taskStatuses.length < totalTasks || jobStatuses.length < totalJobs,
  };
}

function agentPriceHint(
  pricing: AgentPricingRow,
  creditCosts: readonly CreditCost[],
) {
  if (pricing.pricingType === "FREE") {
    return {
      pricingType: pricing.pricingType,
      credits: 0,
      maxCreditsRequired: false,
      minimumMaxCredits: null,
    };
  }

  if (
    pricing.pricingType !== "FIXED" ||
    !pricing.fixedPricing ||
    pricing.fixedPricing.amounts.length === 0
  ) {
    return {
      pricingType: pricing.pricingType,
      credits: null,
      maxCreditsRequired: pricing.pricingType === "FIXED",
      minimumMaxCredits: null,
    };
  }

  try {
    const price = calculateCentsFromMasumiAmountStrings(
      pricing.fixedPricing.amounts.map((amount) => ({
        amount: amount.amount.toString(),
        unit: amount.unit,
      })),
      [...creditCosts],
    );
    return {
      pricingType: pricing.pricingType,
      credits: convertCentsToCredits(price),
      maxCreditsRequired: true,
      minimumMaxCredits: convertCentsToCredits(price),
    };
  } catch {
    return {
      pricingType: pricing.pricingType,
      credits: null,
      maxCreditsRequired: true,
      minimumMaxCredits: null,
    };
  }
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function calculateOmissions(
  counts: Record<string, number>,
  packet: ContextPacketWithoutHash,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => {
      const collection = packet[key as PacketCollectionKey];
      return [key, Math.max(0, count - collection.length)];
    }),
  );
}

function serializePacket(packetWithoutHash: ContextPacketWithoutHash) {
  const packet: SokoBotContextPacket = {
    ...packetWithoutHash,
    hash: hashPacket(packetWithoutHash),
  };
  const serialized = JSON.stringify(packet);
  return {
    packet,
    byteSize: Buffer.byteLength(serialized, "utf8"),
  };
}

function largestTailCollection(
  packet: ContextPacketWithoutHash,
): PacketCollectionKey | null {
  let selected: PacketCollectionKey | null = null;
  let selectedSize = -1;
  for (const key of PACKET_COLLECTION_KEYS) {
    const tail = packet[key].at(-1);
    if (!tail) continue;
    const size = Buffer.byteLength(JSON.stringify(tail), "utf8");
    if (size > selectedSize) {
      selected = key;
      selectedSize = size;
    }
  }
  return selected;
}

function fitPacketToBudget(
  initial: ContextPacketWithoutHash,
  counts: Record<string, number>,
) {
  let packetWithoutHash = initial;
  packetWithoutHash.omissions = calculateOmissions(counts, packetWithoutHash);
  let serialized = serializePacket(packetWithoutHash);

  while (serialized.byteSize > SOKO_BOT_CONTEXT_PACKET_MAX_BYTES) {
    const collection = largestTailCollection(packetWithoutHash);
    if (collection) {
      packetWithoutHash = {
        ...packetWithoutHash,
        [collection]: packetWithoutHash[collection].slice(0, -1),
      };
    } else if (packetWithoutHash.memory.markdown !== "# Soko Bot memory") {
      packetWithoutHash = {
        ...packetWithoutHash,
        memory: {
          ...packetWithoutHash.memory,
          markdown: "# Soko Bot memory",
        },
      };
    } else if (packetWithoutHash.trigger.requestedOutcome) {
      packetWithoutHash = {
        ...packetWithoutHash,
        trigger: {
          ...packetWithoutHash.trigger,
          requestedOutcome: truncateUtf8(
            packetWithoutHash.trigger.requestedOutcome,
            Math.max(
              0,
              Buffer.byteLength(
                packetWithoutHash.trigger.requestedOutcome,
                "utf8",
              ) -
                (serialized.byteSize - SOKO_BOT_CONTEXT_PACKET_MAX_BYTES) -
                128,
            ),
          ),
        },
      };
    } else {
      throw new Error("Soko Bot context packet cannot fit hard byte limit");
    }

    packetWithoutHash.omissions = calculateOmissions(counts, packetWithoutHash);
    serialized = serializePacket(packetWithoutHash);
  }

  return {
    ...serialized,
    omissions: packetWithoutHash.omissions,
  };
}

export class ContextPacketBuilder {
  async build(input: BuildContextPacketInput): Promise<BuiltContextPacket> {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: input.workspaceId,
        OR: [
          { userId: input.userId },
          { organization: { members: { some: { userId: input.userId } } } },
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
              where: { userId: input.userId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!workspace) throw new Error("Workspace is not accessible");

    const organizationId = workspace.organizationId;
    const billingPromise = buildCreditsPayload({
      userId: input.userId,
      organizationId,
      referenceId: organizationId ?? input.userId,
      tx: prisma,
    });
    const agentsPromise = prisma.$transaction(
      [
        prisma.agent.findMany({
          where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
          orderBy: [{ jobCount: "desc" }, { id: "desc" }],
          take: LIMITS.agents,
          select: {
            id: true,
            name: true,
            summary: true,
            description: true,
            capabilityName: true,
            paymentType: true,
            riskClassification: true,
            pricing: {
              select: {
                pricingType: true,
                fixedPricing: {
                  select: {
                    amounts: { select: { amount: true, unit: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.agent.count({
          where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
        }),
        prisma.creditCost.findMany(),
      ],
      AGENT_PRICING_READ_TRANSACTION_OPTIONS,
    );

    const askedByKind = input.askedByKind ?? "OWNER";
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
      prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, name: true, metadata: true },
      }),
      prisma.project.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIMITS.projects,
        select: {
          id: true,
          name: true,
          briefing: true,
          updatedAt: true,
          _count: {
            select: {
              tasks: { where: { archivedAt: null } },
              jobs: true,
            },
          },
        },
      }),
      prisma.task.findMany({
        where: { workspaceId: input.workspaceId, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIMITS.tasks,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          projectId: true,
          assigneeId: true,
          nextRunAt: true,
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
                  },
                },
              },
            },
          },
        },
      }),
      prisma.coworker.findMany({
        where: {
          archivedAt: null,
          OR: [
            { isWhitelisted: true },
            { assignments: { some: { userId: input.userId } } },
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
            where: { userId: input.userId },
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
        where: { ownerId: input.userId, workspaceId: input.workspaceId },
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
        where: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          status: "PENDING",
        },
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
        where: {
          sokoBotId: input.sokoBotId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
        },
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
        where: {
          sokoBotId: input.sokoBotId,
          sokoBot: { userId: input.userId },
        },
        orderBy: { version: "desc" },
        select: { id: true, version: true, hash: true, markdown: true },
      }),
      billingPromise,
      prisma.project.count({ where: { workspaceId: input.workspaceId } }),
      prisma.task.count({
        where: { workspaceId: input.workspaceId, archivedAt: null },
      }),
      prisma.coworker.count({
        where: {
          archivedAt: null,
          OR: [
            { isWhitelisted: true },
            { assignments: { some: { userId: input.userId } } },
            {
              workspaceAccess: {
                some: { workspaceId: input.workspaceId, status: "GRANTED" },
              },
            },
          ],
        },
      }),
      prisma.job.count({
        where: { ownerId: input.userId, workspaceId: input.workspaceId },
      }),
      prisma.sokoBotPendingDecision.count({
        where: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          status: "PENDING",
        },
      }),
      prisma.sokoBotTurn.count({
        where: {
          sokoBotId: input.sokoBotId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
        },
      }),
      // Only a named human is looked up: the owner is already `actor`, and
      // the id behind an assistant's question is its owner, not the asker.
      askedByKind === "TEAMMATE" &&
      input.askedByUserId &&
      input.askedByUserId !== input.userId
        ? prisma.user.findUnique({
            where: { id: input.askedByUserId },
            select: { name: true },
          })
        : null,
    ]);

    const [agents, agentCount, creditCosts] = agentRead;
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
    const packetWithoutHash: ContextPacketWithoutHash = {
      schemaVersion: 1,
      generatedAt,
      trigger: {
        source: input.source,
        route: input.classification.route,
        confidence: input.classification.confidence,
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
              ? sanitizeText(user.name, TEXT_LIMITS.actorName)
              : asker
                ? sanitizeText(asker.name, TEXT_LIMITS.actorName)
                : null,
          trust: "untrusted-data",
        },
      },
      actor: {
        id: boundedIdentifier(user.id),
        name: sanitizeText(user.name, TEXT_LIMITS.actorName),
        locale: actorLocale(user.metadata),
        timezone: actorTimezone(user.metadata),
        workspaceId: boundedIdentifier(workspace.id),
        organizationId: boundedIdentifier(workspace.organizationId),
        organizationName: sanitizeText(
          workspace.organization?.name ?? null,
          TEXT_LIMITS.organizationName,
        ),
        role:
          sanitizeText(
            workspace.organization?.members[0]?.role ?? "owner",
            TEXT_LIMITS.role,
          ) ?? "owner",
        trust: "untrusted-data",
      },
      workspace: {
        id: boundedIdentifier(workspace.id),
        scope: organizationId ? "organization" : "personal",
        plan: sanitizeText(
          billing.subscription?.plan ??
            (billing.extra.enterprise ? "enterprise" : "free"),
          TEXT_LIMITS.billingLabel,
        ),
        subscriptionStatus: sanitizeText(
          billing.subscription?.status ?? null,
          TEXT_LIMITS.billingLabel,
        ),
        availableCredits: finiteNonNegative(billing.credits.total),
        bufferCredits: finiteNonNegative(billing.credits.buffer),
        subscriptionRemainingCredits: finiteNonNegative(
          billing.subscription?.credits?.remaining,
        ),
        enterpriseRemainingCredits: finiteNonNegative(
          billing.extra.enterprise?.credits.remaining,
        ),
      },
      projects: projects.map((project) => ({
        id: boundedIdentifier(project.id),
        name: sanitizeText(project.name, TEXT_LIMITS.name),
        summary: sanitizeText(project.briefing, TEXT_LIMITS.summary),
        status: projectStatus(
          project.id,
          project._count.tasks,
          project._count.jobs,
          tasks,
          jobs,
        ),
        updatedAt: project.updatedAt.toISOString(),
        trust: "untrusted-data",
      })),
      tasks: tasks.map((task) => ({
        id: boundedIdentifier(task.id),
        name: sanitizeText(task.name, TEXT_LIMITS.name),
        summary: sanitizeText(task.description, TEXT_LIMITS.summary),
        status: task.status,
        priority: null,
        dueAt: null,
        scheduledAt: task.nextRunAt?.toISOString() ?? null,
        projectId: boundedIdentifier(task.projectId),
        coworkerId: boundedIdentifier(task.assigneeId),
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
      agents: agents.map((agent) => ({
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
        price: agentPriceHint(agent.pricing, creditCosts),
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
      recentTurns: [...recentTurns].reverse().map((turn) => ({
        id: boundedIdentifier(turn.id),
        source: turn.source,
        status: turn.status,
        route: turn.route,
        userMessage: sanitizeText(turn.userMessage, TEXT_LIMITS.turnMessage),
        finalAnswer: sanitizeText(turn.finalAnswer, TEXT_LIMITS.turnAnswer),
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
    const fitted = fitPacketToBudget(
      input.audience === "TEAMMATE"
        ? redactForTeammate(packetWithoutHash)
        : packetWithoutHash,
      counts,
    );

    return {
      packet: fitted.packet,
      byteSize: fitted.byteSize,
      tokenEstimate: Math.ceil(fitted.byteSize / 4),
      counts,
      omissions: fitted.omissions,
    };
  }
}
