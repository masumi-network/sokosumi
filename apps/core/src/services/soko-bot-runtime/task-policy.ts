import { type Prisma } from "@sokosumi/database";
import {
  getSokoBotVersion,
  sokoBotCreateTaskInputSchema,
} from "@sokosumi/soko-bot";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import {
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

export function toolAssigneeFields(
  coworkerId: string | null | undefined,
  sokoBotId: string,
  ownerUserId?: string | null,
): {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
} {
  if (ownerUserId) {
    if (coworkerId)
      throw new SokoBotRuntimeValidationError(
        "Give coworkerId or a person to assign, not both",
      );
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: ownerUserId,
    };
  }
  if (coworkerId == null) return {};
  if (coworkerId === sokoBotId) {
    return { assigneeId: null, assigneeSokoBotId: sokoBotId };
  }
  return { assigneeId: coworkerId, assigneeSokoBotId: null };
}

/**
 * Cuso's owner works in CMO, which has no Task board: a Task there is work
 * for a Coworker, and CMO's chat shows it. What a person has to do, Cuso
 * says in chat, where they will read it.
 */
export function refuseCusoPersonTask(
  versionId: string | null | undefined,
  input: {
    coworkerId?: string | null;
    assignToOwner?: true;
    memberId?: string;
  },
  /** Creating: a Task with nobody on it is a to-do for a person as well. */
  creating: boolean,
): void {
  if (getSokoBotVersion(versionId).profile !== "cmo") return;
  if (input.assignToOwner || input.memberId || (creating && !input.coworkerId))
    throw new SokoBotRefusedUnsentError(
      "Here a Task is work for a Coworker; a person never sees one. Tell the owner in your answer what you need them to do, or give the work to a Coworker with coworkerId.",
    );
}

export const MAX_BOT_COMMENTS_PER_TASK_PER_DAY = 3;

/** The longest Task description or comment the tool schemas accept. */
export const TASK_TEXT_MAX_CHARS = 20_000;

export const ACTIVE_STATUSES = [
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
] as const;

async function singleEventTaskIdForTurn(
  db: Pick<Prisma.TransactionClient, "sokoBotEventInbox">,
  turn: { id: string; sokoBotId: string; source: string | null },
): Promise<string | null> {
  if (turn.source !== "EVENT") {
    return null;
  }
  const entries = await db.sokoBotEventInbox.findMany({
    where: { turnId: turn.id, botId: turn.sokoBotId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const [only] = entries;
  return entries.length === 1 && only ? only.entityId : null;
}

function alternateCreateTaskEventInputWithTaskId(
  rawInput: unknown,
  singleEventTaskId: string | null,
): unknown | null {
  if (
    singleEventTaskId === null ||
    !rawInput ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    return null;
  }
  const record = rawInput as Record<string, unknown>;
  if (record.triggeringTaskId === undefined) {
    return { ...record, triggeringTaskId: singleEventTaskId };
  }
  if (record.triggeringTaskId === singleEventTaskId) {
    const { triggeringTaskId: _ignored, ...withoutTrigger } = record;
    return withoutTrigger;
  }
  return null;
}

/**
 * Normalizes a valid `create_task` input after applying Task domain defaults
 * (`description: undefined | null | ""` -> omitted, default `status: "DRAFT"`,
 * `projectId: undefined | null` or sub-task `projectId` -> omitted,
 * `coworkerId: undefined | null` -> omitted, empty/duplicate `fileIds` ->
 * omitted/deduped, trimmed strings, and implicit <-> explicit
 * `triggeringTaskId` on a single-Task EVENT wake).
 */
export function canonicalCreateTaskInput(
  rawInput: unknown,
  singleEventTaskId: string | null,
): Record<string, unknown> | null {
  const parsed = sokoBotCreateTaskInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  const normalized: Record<string, unknown> = {
    name: data.name,
    status: data.status,
  };
  const description = data.description ?? "";
  if (description !== "") {
    normalized.description = description;
  }
  const projectId = data.parentTaskId ? null : (data.projectId ?? null);
  if (projectId !== null) {
    normalized.projectId = projectId;
  }
  if (data.coworkerId != null) {
    normalized.coworkerId = data.coworkerId;
  }
  if (data.assignToOwner) {
    normalized.assignToOwner = true;
  }
  if (data.memberId !== undefined) {
    normalized.memberId = data.memberId;
  }
  if (data.fileIds?.length) {
    normalized.fileIds = Array.from(new Set(data.fileIds));
  }
  if (data.followUp !== undefined) {
    normalized.followUp = data.followUp;
  }
  if (
    data.followUpAllows &&
    (data.followUpAllows.images !== undefined ||
      data.followUpAllows.maxCredits !== undefined)
  ) {
    const allows: Record<string, number> = {};
    if (data.followUpAllows.images !== undefined) {
      allows.images = data.followUpAllows.images;
    }
    if (data.followUpAllows.maxCredits !== undefined) {
      allows.maxCredits = data.followUpAllows.maxCredits;
    }
    normalized.followUpAllows = allows;
  }
  if (data.parentTaskId !== undefined) {
    normalized.parentTaskId = data.parentTaskId;
  }
  if (data.afterTaskId !== undefined) {
    normalized.afterTaskId = data.afterTaskId;
  }
  if (
    data.triggeringTaskId !== undefined &&
    (singleEventTaskId === null || data.triggeringTaskId !== singleEventTaskId)
  ) {
    normalized.triggeringTaskId = data.triggeringTaskId;
  }
  return normalized;
}

export interface CreateTaskInputIdentity {
  primaryHash: string;
  candidateHashes: string[];
  canonicalHash: string | null;
  canonicalInput: Record<string, unknown> | null;
  singleEventTaskId: string | null;
}

function isClippedAuditObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).truncated === true
  );
}

/**
 * Extracts the canonical `create_task` input digest from a persisted audit
 * `input` JSON value: reads `canonicalInputHash` preserved on clipped (>16 KB)
 * rows, or canonicalizes unclipped rows directly. Returns `null` for
 * historical clipped rows stored before `canonicalInputHash` existed.
 */
export function createTaskCanonicalInputHashFromAudit(
  auditInput: unknown,
  singleEventTaskId: string | null,
): string | null {
  if (isClippedAuditObject(auditInput)) {
    return typeof auditInput.canonicalInputHash === "string" &&
      auditInput.canonicalInputHash.length > 0
      ? auditInput.canonicalInputHash
      : null;
  }
  const canonical = canonicalCreateTaskInput(auditInput, singleEventTaskId);
  return canonical !== null ? actionInputHash(canonical) : null;
}

/**
 * Compares a full `create_task` retry against a historical clipped audit row
 * (`truncated: true` without `canonicalInputHash`):
 * - `"match"`: candidate's stored `inputHash` matches a default-spelling
 *   variant (e.g. `coworkerId: null`, `projectId: null`, omitted `status`,
 *   empty `fileIds`, explicit `triggeringTaskId`) of the full retry.
 * - `"distinct"`: kept audit metadata (`name`, `status`) proves the two Tasks
 *   differ.
 * - `"ambiguous"`: the historical clipped row could be the same Task under an
 *   unreconstructible pre-clip spelling (e.g. untrimmed whitespace or redacted
 *   body) and must be reconciled before creating another Task.
 */
export function compareHistoricalClippedCreateTask(
  candidate: { inputHash: string; input?: unknown },
  canonicalInput: Record<string, unknown>,
  rawInput: unknown,
  singleEventTaskId: string | null,
): "match" | "distinct" | "ambiguous" | null {
  if (!isClippedAuditObject(candidate.input)) {
    return null;
  }
  if (
    typeof candidate.input.canonicalInputHash === "string" &&
    candidate.input.canonicalInputHash.length > 0
  ) {
    return null;
  }
  const rawRecord =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : null;
  const nameOptions =
    typeof rawRecord?.name === "string" &&
    rawRecord.name !== canonicalInput.name
      ? [canonicalInput.name, rawRecord.name]
      : [canonicalInput.name];
  const coworkerOptions =
    canonicalInput.coworkerId === undefined
      ? [undefined, null]
      : [canonicalInput.coworkerId];
  const projectOptions =
    canonicalInput.projectId === undefined
      ? [undefined, null]
      : [canonicalInput.projectId];
  const descriptionOptions =
    canonicalInput.description === undefined
      ? [undefined, null, ""]
      : typeof rawRecord?.description === "string" &&
          rawRecord.description !== canonicalInput.description
        ? [canonicalInput.description, rawRecord.description]
        : [canonicalInput.description];
  const statusOptions =
    canonicalInput.status === "DRAFT"
      ? ["DRAFT", undefined]
      : [canonicalInput.status];
  const fileIdsOptions =
    canonicalInput.fileIds === undefined
      ? [undefined, [] as string[]]
      : [canonicalInput.fileIds];
  const triggerOptions =
    singleEventTaskId !== null && canonicalInput.triggeringTaskId === undefined
      ? [undefined, singleEventTaskId]
      : [canonicalInput.triggeringTaskId];

  for (const name of nameOptions) {
    for (const coworkerId of coworkerOptions) {
      for (const projectId of projectOptions) {
        for (const description of descriptionOptions) {
          for (const status of statusOptions) {
            for (const fileIds of fileIdsOptions) {
              for (const triggeringTaskId of triggerOptions) {
                const variant: Record<string, unknown> = {
                  ...canonicalInput,
                  name,
                  coworkerId,
                  projectId,
                  description,
                  status,
                  fileIds,
                  triggeringTaskId,
                };
                if (actionInputHash(variant) === candidate.inputHash) {
                  return "match";
                }
              }
            }
          }
        }
      }
    }
  }

  const keptName =
    typeof candidate.input.name === "string"
      ? candidate.input.name.trim()
      : null;
  if (
    keptName !== null &&
    typeof canonicalInput.name === "string" &&
    keptName !== canonicalInput.name
  ) {
    return "distinct";
  }
  const keptStatus =
    typeof candidate.input.status === "string" ? candidate.input.status : null;
  if (
    keptStatus !== null &&
    typeof canonicalInput.status === "string" &&
    keptStatus !== canonicalInput.status
  ) {
    return "distinct";
  }
  return "ambiguous";
}

/**
 * Computes the canonical `create_task` input hash plus legacy lookup hashes
 * so retries with equivalent domain defaults (`description: undefined` vs
 * `null` vs `""`, omitted `status` vs `"DRAFT"`, omitted vs explicit
 * `triggeringTaskId`) resolve to one reservation while preserving lookup of
 * pre-existing raw receipts written before canonicalization.
 */
export async function createTaskInputIdentity(
  db: Pick<Prisma.TransactionClient, "sokoBotEventInbox">,
  turn: { id: string; sokoBotId: string; source: string | null },
  rawInput: unknown,
): Promise<CreateTaskInputIdentity> {
  const singleEventTaskId = await singleEventTaskIdForTurn(db, turn);
  const rawHash = actionInputHash(rawInput ?? null);
  const rawAlternate = alternateCreateTaskEventInputWithTaskId(
    rawInput,
    singleEventTaskId,
  );
  const rawAlternateHash =
    rawAlternate !== null ? actionInputHash(rawAlternate) : null;
  const canonical = canonicalCreateTaskInput(rawInput, singleEventTaskId);
  const candidates = new Set<string>();
  candidates.add(rawHash);
  if (rawAlternateHash !== null) {
    candidates.add(rawAlternateHash);
  }
  let canonicalHash: string | null = null;
  if (canonical !== null) {
    canonicalHash = actionInputHash(canonical);
    candidates.add(canonicalHash);
    if (
      singleEventTaskId !== null &&
      canonical.triggeringTaskId === undefined
    ) {
      candidates.add(
        actionInputHash({
          ...canonical,
          triggeringTaskId: singleEventTaskId,
        }),
      );
    }
    if (canonical.status === "DRAFT") {
      const { status: _draft, ...withoutDraftStatus } = canonical;
      candidates.add(actionInputHash(withoutDraftStatus));
      if (
        singleEventTaskId !== null &&
        canonical.triggeringTaskId === undefined
      ) {
        candidates.add(
          actionInputHash({
            ...withoutDraftStatus,
            triggeringTaskId: singleEventTaskId,
          }),
        );
      }
    }
  }
  return {
    // Keep the raw input hash as the stored primary operationKey so mixed-version
    // old workers (both CHAT and EVENT) continue to hit receipts written by new
    // workers, while new workers also deduplicate domain-default equivalents via
    // candidate keys and same-scope canonical input matching under the turn lock.
    primaryHash: rawHash,
    candidateHashes: Array.from(candidates),
    canonicalHash,
    canonicalInput: canonical,
    singleEventTaskId,
  };
}

/**
 * Returns the equivalent alternate `create_task` input form on a single-Task
 * EVENT wake: when `triggeringTaskId` is omitted, returns the explicit form
 * with that single Task ID; when `triggeringTaskId` matches that single Task
 * ID, returns the implicit form without `triggeringTaskId`.
 */
export async function alternateCreateTaskEventInput(
  db: Pick<Prisma.TransactionClient, "sokoBotEventInbox">,
  turn: { id: string; sokoBotId: string; source: string | null },
  rawInput: unknown,
): Promise<unknown | null> {
  const singleEventTaskId = await singleEventTaskIdForTurn(db, turn);
  return alternateCreateTaskEventInputWithTaskId(rawInput, singleEventTaskId);
}

/**
 * The Task an event turn's batch is about, when there is only one: a follow-up
 * created on that turn belongs to it. With several, the model has to say which.
 */
export async function onlyEventTask(
  tx: Prisma.TransactionClient,
  turn: { id: string; sokoBotId: string },
): Promise<string> {
  const entries = await tx.sokoBotEventInbox.findMany({
    where: { turnId: turn.id, botId: turn.sokoBotId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const [only] = entries;
  if (entries.length === 1 && only) return only.entityId;
  throw new SokoBotRuntimeValidationError(
    entries.length
      ? `Set triggeringTaskId to the event's Task this follows up: one of ${entries.map((entry) => entry.entityId).join(", ")}.`
      : "This event turn has no Task to follow up, so it cannot create one.",
  );
}

/** Fields that name a Task by id in tool input. */
export const TASK_ID_FIELDS = ["taskId", "peerTaskId"] as const;

export const TASK_ID_PREFIX = 23;
