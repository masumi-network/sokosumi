import { createHash } from "node:crypto";
import type {
  SokoBotContextPacket,
  TurnClassification,
} from "@sokosumi/soko-bot";
import {
  redactSokoBotSensitiveText,
  sanitizeSokoBotMemoryMarkdown,
} from "@sokosumi/soko-bot";
import { DAY_MS } from "@/config/constants";
import type { BuildContextPacketInput } from "./context-packet";
import { buildSourceCoverage } from "./source-coverage";

export const LIMITS = {
  projects: 12,
  /** The rest by name only, so a Project the owner names can be found. */
  projectNames: 100,
  tasks: 24,
  /** Slots kept for work that finished this week, so a wrap can say what moved. */
  finishedTasks: 6,
  blockersPerTask: 5,
  coworkers: 24,
  coworkerCapabilities: 12,
  agents: 24,
  jobs: 24,
  pendingDecisions: 12,
  recentTurns: 12,
} as const;

export const TEXT_LIMITS = {
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
  turnMessage: 500,
  selfStartedTurnMessage: 80,
  turnAnswer: 600,
  /** The newest reply in full: its closing question is what "yes" answers. */
  latestTurnAnswer: 4_000,
  memoryBytes: 8_192,
} as const;

export const SOKO_BOT_CONTEXT_PACKET_MAX_BYTES = 48 * 1_024;

/**
 * What the packet gives up first when it is over budget: the marketplace and
 * old jobs, then the oldest conversation, and the owner's Tasks last. Dropping
 * the largest item instead cost every Task first, since Tasks are the biggest.
 */
const PACKET_TRIM_ORDER = [
  "agents",
  "jobs",
  "recentTurns",
  "coworkers",
  "projects",
  "pendingDecisions",
  "tasks",
] as const satisfies readonly (keyof typeof LIMITS)[];

type PacketCollectionKey = (typeof PACKET_TRIM_ORDER)[number];

/** Routes that can hire; everywhere else `find_agents` reads the marketplace. */
export const MARKETPLACE_ROUTES = new Set<TurnClassification["route"]>([
  "HIRE_AGENT",
  "MIXED",
]);

export const FINISHED_TASK_WINDOW_MS = 7 * DAY_MS;

export type ContextPacketWithoutHash = Omit<SokoBotContextPacket, "hash">;

interface ProjectStatusTask {
  projectId: string | null;
  status: string;
}

interface ProjectStatusJob {
  projectId: string | null;
  events: readonly { status: string }[];
}

/** A signal at or above this becomes a hint. */
const LIKELY_SIGNAL = 0.6;
/** Below this the message is not about the board, so fewer Tasks come along. */
export const UNLIKELY_SIGNAL = 0.2;
/** Tasks a typed turn carries when it is not about the board. */
export const OFF_TOPIC_TASKS = 8;

/**
 * What Core noticed about a typed message, in plain words. Each hint adds
 * context; none narrows the turn, which holds every tool whatever Jev said.
 */
export function triggerHints(input: BuildContextPacketInput): string[] {
  if (!input.personAsked) return [];
  const { signals } = input.classification;
  return [
    ...((signals?.refersToEarlier ?? 0) >= LIKELY_SIGNAL
      ? [
          "The message likely points back at earlier messages in this chat, your own posts included: read the CONTEXT block and recentTurns first.",
        ]
      : []),
    ...((signals?.aboutMail ?? 0) >= LIKELY_SIGNAL
      ? [
          "The message is likely about mail, the calendar, or alerts you posted.",
        ]
      : []),
    ...(input.capturedPreference
      ? [
          `Saved to your memory's preferences from this message: "${input.capturedPreference}". Tell the owner in one line what you will do differently; correct it with update_memory if it is wrong.`,
        ]
      : (signals?.statesPreference ?? 0) >= LIKELY_SIGNAL
        ? ["The message may state a lasting preference."]
        : []),
  ];
}

export function sanitizeText(
  value: string | null,
  maxLength: number,
): string | null {
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

export function sanitizeMemory(value: string): string {
  const normalized = sanitizeSokoBotMemoryMarkdown(value)
    .replaceAll(/\r\n?/g, "\n")
    .trim();
  return truncateUtf8(normalized, TEXT_LIMITS.memoryBytes);
}

export function boundedIdentifier(value: string | null): string | null {
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

export function actorLocale(metadata: string | null): string | null {
  const locale = sanitizeText(
    readMetadataString(metadata, ["locale"]),
    TEXT_LIMITS.locale,
  );
  return locale && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale)
    ? locale
    : null;
}

export function actorTimezone(metadata: string | null): string | null {
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

export function sanitizeStringList(
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

export function projectStatus(
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

export function finiteNonNegative(
  value: number | null | undefined,
): number | null {
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
  const privateAudience = packetWithoutHash.trigger.askedBy.kind !== "OWNER";
  packetWithoutHash.sourceCoverage = Object.fromEntries(
    ["projects", "tasks", "jobs", "recentTurns", "mail", "calendar"].map(
      (source) => {
        const external = source === "mail" || source === "calendar";
        const forbidden =
          privateAudience && (external || source === "recentTurns");
        const included =
          external || forbidden
            ? 0
            : packetWithoutHash[source as PacketCollectionKey].length;
        const omitted =
          external || forbidden
            ? 0
            : (packetWithoutHash.omissions[source] ?? 0);
        return [
          source,
          buildSourceCoverage({
            source,
            checkedAt:
              external || forbidden ? null : packetWithoutHash.generatedAt,
            filters: {
              scope:
                source === "recentTurns"
                  ? "Current room and requester only"
                  : external
                    ? "No integration window queried"
                    : "Authorized workspace records; bounded summaries, not complete artifacts",
            },
            scannedCount: included + omitted,
            includedCount: included,
            omittedCount: omitted,
            completeness:
              external || forbidden
                ? "NOT_CHECKED"
                : omitted > 0
                  ? "TRUNCATED"
                  : "COMPLETE",
            availability: forbidden
              ? "PERMISSION_DENIED"
              : external
                ? "NOT_FETCHED"
                : "AVAILABLE",
          }),
        ];
      },
    ),
  );

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

/**
 * The conversation the bot can never read back with a tool, kept even when
 * Tasks have to give way: trimmed to its last three turns, "stop messaging me
 * about these" lost the inbox post it pointed at.
 */
const MIN_RECENT_TURNS = 8;

/** Drops one item: the oldest turn, or the last of any other collection. */
function trimOne(
  packet: ContextPacketWithoutHash,
): ContextPacketWithoutHash | null {
  for (const key of PACKET_TRIM_ORDER) {
    const items = packet[key];
    if (key === "recentTurns" && items.length <= MIN_RECENT_TURNS) continue;
    const index = key === "recentTurns" ? 0 : items.length - 1;
    const item = items[index];
    if (!item || ("requiredReference" in item && item.requiredReference))
      continue;
    return {
      ...packet,
      [key]: items.filter((_, position) => position !== index),
    };
  }
  // Nothing else is left to give: the oldest turn goes before memory does.
  return packet.recentTurns.length
    ? { ...packet, recentTurns: packet.recentTurns.slice(1) }
    : null;
}

export function fitPacketToBudget(
  initial: ContextPacketWithoutHash,
  counts: Record<string, number>,
) {
  let packetWithoutHash = initial;
  packetWithoutHash.omissions = calculateOmissions(counts, packetWithoutHash);
  let serialized = serializePacket(packetWithoutHash);

  while (serialized.byteSize > SOKO_BOT_CONTEXT_PACKET_MAX_BYTES) {
    const trimmed = trimOne(packetWithoutHash);
    if (trimmed) {
      packetWithoutHash = trimmed;
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
