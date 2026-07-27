import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma } from "@sokosumi/database";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import {
  isUserUploadAllowedContentType,
  normalizeUserUploadContentType,
  planUnlocksPersonalAssistant,
  resolveUserUploadContentType,
  sniffImageMimeFromBytes,
  USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { HTTPException } from "hono/http-exception";
import { v5 as uuidv5 } from "uuid";
import {
  buildMcpUrl,
  ComposioApiError,
  ComposioConfigError,
  composioToolkitForProvider,
  ensureAuthConfig,
  ensureMcpServer,
  getConnection,
  initiateConnection,
} from "@/clients/composio.client";
import {
  approveConfirmation,
  connectInstanceIntegration,
  destroyInstance,
  disconnectInstanceIntegration,
  ensureInstanceReady,
  getInstance,
  getInstanceOnboardingProgress,
  type HermesInstallSkillInput,
  HermesInstanceNotReadyError,
  type HermesInstanceStatus,
  type HermesIntegrationMode,
  type HermesIntegrationProvider,
  HermesOrchestratorError,
  type HermesPendingConfirmation,
  installSkill,
  isReservedSecretKey,
  isValidSecretKey,
  listInstalledSkills,
  listInstanceIntegrations,
  listInstanceSchedules,
  listPreinstalledSkills,
  patchInstance,
  patchSchedule,
  provisionInstance,
  proxyChatCompletions,
  rejectConfirmation,
  removeInstalledSkill,
  setInstanceSecret,
  startInstanceOnboarding,
} from "@/clients/hermes-orchestrator.client";
import {
  browseSkills,
  getCuratedSkills,
  getSkillAudit,
  getSkillDetail,
  SkillsShUnavailableError,
  searchSkills,
  worstAuditRisk,
} from "@/clients/skills-sh.client";
import {
  getWebAppBaseUrl,
  resolveSokosumiEnvForOrchestrator,
} from "@/config/env";
import {
  badRequest,
  conflict,
  forbidden,
  internalServerError,
  notFound,
  payloadTooLarge,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import {
  clearHermesLocalMirrorForUser,
  ensureOrchestratorForUser,
} from "@/helpers/orchestrator-instance";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { conflictWithData, ok } from "@/helpers/response";
import { buildAccessibleCoworkerMembershipOr } from "@/helpers/vendor-membership";

import prisma from "@/lib/db/prisma";
import { isTransientFetchError } from "@/lib/external-service-errors";
import { OpenAPIHonoWithAuth, withGlobalHeaderParameters } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import {
  hermesApproveConfirmationRequestSchema,
  hermesChatRequestSchema,
  hermesChatResponseSchema,
  hermesConfirmationResolveResponseSchema,
  hermesEmptyResponseSchema,
  hermesFinalizeIntegrationRequestSchema,
  hermesGetInstanceEnvelopeSchema,
  hermesInitiateIntegrationRequestSchema,
  hermesInitiateIntegrationResponseSchema,
  hermesInstanceNotReadySchema,
  hermesInstanceSchema,
  hermesIntegrationProviderSchema,
  hermesIntegrationSchema,
  hermesIntegrationsListResponseSchema,
  hermesOnboardingProgressSchema,
  hermesPatchScheduleRequestSchema,
  hermesPersistedMessageSchema,
  hermesRejectConfirmationRequestSchema,
  hermesScheduleSchema,
  hermesSchedulesListResponseSchema,
  hermesStartOnboardingRequestSchema,
  hermesUnreadCountSchema,
  hermesUpdateInstanceRequestSchema,
  markHermesInboxSeenRequestSchema,
  setHermesSecretRequestSchema,
} from "@/schemas/hermes.schema";
import {
  type CursorPaginationMeta,
  cursorPaginationQuerySchema,
} from "@/schemas/pagination.schema";
import {
  installedSkillsListSchema,
  installSkillRequestSchema,
  installSkillResponseSchema,
  preinstalledSkillsListSchema,
  skillCatalogDetailSchema,
  skillCatalogListSchema,
  skillsBrowseQuerySchema,
  skillsDetailQuerySchema,
  skillsSearchQuerySchema,
} from "@/schemas/skills.schema";
import { syncHermesInboxForUser } from "@/services/hermes-inbox-sync.service";

const TAGS = ["Hermes"];
const MAX_USER_CONTENT_BYTES = 32_000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;
/**
 * Maximum UTF-16 code units per inlined text attachment after UTF-8 decode
 * (`String.prototype.slice` / `String#length`), not UTF-8 byte length.
 */
const MAX_INLINED_TEXT_UTF16_CODE_UNITS = 200 * 1024;
/** Max persisted turns sent to the Hermes proxy per request (newest first in DB). */
const MAX_CHAT_CONTEXT_MESSAGES = 100;
const CHAT_RECOVERY_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
/** Inline transcript retries before returning 200 after a successful proxy. */
const CHAT_TRANSCRIPT_INLINE_RETRY_DELAYS_MS = [0, 250, 750];

/**
 * RFC-4122 UUID matcher (any version, dashed canonical form). Used to
 * find coworker/organization ids embedded in confirmation summaries the
 * orchestrator writes — see `enrichPendingConfirmations`.
 */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface DecodedFile {
  name: string;
  type: string;
  bytes: Buffer;
  dataUrl: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "file";
      file: { filename: string; file_data: string };
    };

type MessageContent = string | ContentPart[];

interface OutboundChatMessage {
  role: "user" | "assistant" | "system";
  content: MessageContent;
}

interface OpenAIChatChoice {
  message?: { role?: string; content?: string };
  finish_reason?: string;
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[];
}

function isHermesVisionImageMime(type: string): boolean {
  return (
    type.startsWith("image/") && USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET.has(type)
  );
}

/** Text and JSON: inlined inside the leading `{ type: "text" }` part. */
function isHermesUtf8InlineMime(type: string): boolean {
  if (type.startsWith("text/")) return true;
  return type === "application/json";
}

/** Non-image, non–UTF-8-inline: OpenRouter chat `content` file parts (PDF, Office, media, …). */
function isHermesBinaryFileAttachmentMime(type: string): boolean {
  return (
    USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET.has(type) &&
    !isHermesVisionImageMime(type) &&
    !isHermesUtf8InlineMime(type)
  );
}

function isValidRole(role: string): role is "user" | "assistant" | "system" {
  return role === "user" || role === "assistant" || role === "system";
}

function findUuidMatches(value: string): string[] {
  return Array.from(
    value.matchAll(new RegExp(UUID_PATTERN.source, "gi")),
    ([match]) => match,
  );
}

function decodeDataUrl(
  dataUrl: string,
): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]*);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;

  try {
    const rawMime = match[1]!.trim();
    const mime =
      rawMime === "" ? "application/octet-stream" : rawMime.toLowerCase();
    return { mime, bytes: Buffer.from(match[2]!, "base64") };
  } catch {
    return null;
  }
}

function isUndeterminedClientMime(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === "" || t === "application/octet-stream";
}

function dataUrlWithMime(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * When the client sends an empty or generic MIME (common when `File.type` is
 * blank and the UI falls back to `application/octet-stream`), infer a concrete
 * allowed type from the data URL, magic bytes, or filename before validating.
 *
 * Allowed types match `USER_UPLOAD_ALLOWED_CONTENT_TYPES` (same as user uploads).
 */
function resolveHermesUploadedMime(
  name: string,
  clientTypeRaw: string,
  parsedMime: string,
  bytes: Buffer,
): { effectiveMime: string; dataUrl: string } {
  const clientNorm = normalizeUserUploadContentType(clientTypeRaw);
  const dataMimeNorm = normalizeUserUploadContentType(parsedMime);

  const clientUndetermined = isUndeterminedClientMime(clientTypeRaw);
  const dataUndetermined = isUndeterminedClientMime(parsedMime);

  if (!clientUndetermined) {
    if (!isUserUploadAllowedContentType(clientNorm)) {
      throw badRequest(`Unsupported file type: ${clientTypeRaw.trim()}.`);
    }

    if (!dataUndetermined && dataMimeNorm !== clientNorm) {
      throw badRequest(`File "${name}" MIME type does not match its data URL.`);
    }

    return {
      effectiveMime: clientNorm,
      dataUrl: dataUrlWithMime(clientNorm, bytes),
    };
  }

  if (!dataUndetermined && isUserUploadAllowedContentType(dataMimeNorm)) {
    return {
      effectiveMime: dataMimeNorm,
      dataUrl: dataUrlWithMime(dataMimeNorm, bytes),
    };
  }

  const sniffed = sniffImageMimeFromBytes(bytes);
  if (sniffed && isUserUploadAllowedContentType(sniffed)) {
    return { effectiveMime: sniffed, dataUrl: dataUrlWithMime(sniffed, bytes) };
  }

  const inferred = resolveUserUploadContentType(
    name,
    "application/octet-stream",
  );
  if (inferred) {
    return {
      effectiveMime: inferred,
      dataUrl: dataUrlWithMime(inferred, bytes),
    };
  }

  throw badRequest(
    `Could not determine a supported type for "${name}". ` +
      "Use the same kinds of files supported elsewhere in Sokosumi " +
      "(for example images, PDF, Office documents, plain text, CSV, or common media), " +
      "or pick a file whose extension matches an allowed type.",
  );
}

function validateAndDecodeFiles(
  raw: z.infer<typeof hermesChatRequestSchema>["files"],
): DecodedFile[] {
  if (!raw || raw.length === 0) return [];
  if (raw.length > MAX_FILES) {
    throw badRequest(`You can upload at most ${MAX_FILES} files.`);
  }

  const decoded: DecodedFile[] = [];
  let totalBytes = 0;

  for (const file of raw) {
    const parsed = decodeDataUrl(file.dataUrl);
    if (!parsed) {
      throw badRequest(`File "${file.name}" is not a valid base64 data URL.`);
    }

    if (parsed.bytes.length > MAX_FILE_BYTES) {
      throw payloadTooLarge(`File "${file.name}" is larger than 20 MB.`);
    }

    totalBytes += parsed.bytes.length;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      throw payloadTooLarge("Uploaded files are larger than 20 MB in total.");
    }

    const { effectiveMime, dataUrl } = resolveHermesUploadedMime(
      file.name,
      file.type,
      parsed.mime,
      parsed.bytes,
    );

    decoded.push({
      name: file.name,
      type: effectiveMime,
      bytes: parsed.bytes,
      dataUrl,
    });
  }

  return decoded;
}

function buildUserMessageForHermes(
  trimmed: string,
  files: DecodedFile[],
): OutboundChatMessage {
  if (files.length === 0) {
    return { role: "user", content: trimmed };
  }

  const textFiles = files.filter((file) => isHermesUtf8InlineMime(file.type));
  const imageFiles = files.filter((file) => isHermesVisionImageMime(file.type));
  const fileAttachments = files.filter((file) =>
    isHermesBinaryFileAttachmentMime(file.type),
  );

  let textBody = trimmed;

  for (const file of textFiles) {
    const fullText = file.bytes.toString("utf8");
    const text = fullText.slice(0, MAX_INLINED_TEXT_UTF16_CODE_UNITS);
    const truncatedMarker =
      text.length < fullText.length ? "\n...(truncated)" : "";
    textBody += `\n\n--- attached file: ${file.name} (${file.type}) ---\n\`\`\`\n${text}${truncatedMarker}\n\`\`\`\n--- end ${file.name} ---`;
  }

  const hasStructured = imageFiles.length > 0 || fileAttachments.length > 0;
  if (!hasStructured) {
    return { role: "user", content: textBody };
  }

  if (!textBody.trim()) {
    textBody = "Please use the attached file(s).";
  }

  return {
    role: "user",
    content: [
      { type: "text", text: textBody },
      ...imageFiles.map((file) => ({
        type: "image_url" as const,
        image_url: { url: file.dataUrl },
      })),
      ...fileAttachments.map((file) => ({
        type: "file" as const,
        file: {
          filename: file.name,
          file_data: file.dataUrl,
        },
      })),
    ],
  };
}

function buildPersistedUserContent(
  trimmed: string,
  files: DecodedFile[],
): string {
  if (files.length === 0) return trimmed;

  const names = files.map((file) => file.name).join(", ");
  return trimmed
    ? `${trimmed}\n\nAttached files: ${names}`
    : `Attached files: ${names}`;
}

/**
 * Resolve UUIDs the orchestrator embeds in confirmation summaries
 * (e.g. "assign to coworker 0e8c93b0-…") into coworker / organization
 * records so the UI can render avatar + name chips instead of raw ids.
 *
 * Scoped to the caller — coworkers must be marketplace-whitelisted or
 * accessible via vendor-admin / assignment membership; organizations
 * require membership. Prevents enumerating private rows by feeding
 * crafted summaries through the orchestrator.
 *
 * Best-effort: a DB hiccup here must not 500 the whole instance fetch.
 */
async function enrichPendingConfirmations(
  confirmations: HermesPendingConfirmation[],
  userId: string,
): Promise<HermesPendingConfirmation[]> {
  if (confirmations.length === 0) return confirmations;

  const allIds = new Set<string>();
  for (const confirmation of confirmations) {
    const matches = findUuidMatches(confirmation.summary);
    for (const id of matches) allIds.add(id.toLowerCase());
  }
  if (allIds.size === 0) return confirmations;

  const ids = Array.from(allIds);
  let coworkers: Array<{ id: string; name: string; image: string | null }> = [];
  let organizations: Array<{ id: string; name: string; slug: string | null }> =
    [];
  try {
    [coworkers, organizations] = await Promise.all([
      prisma.coworker.findMany({
        where: {
          id: { in: ids },
          OR: [
            { isWhitelisted: true },
            ...buildAccessibleCoworkerMembershipOr(userId),
          ],
        },
        select: { id: true, name: true, image: true },
      }),
      prisma.organization.findMany({
        where: {
          id: { in: ids },
          members: { some: { userId } },
        },
        select: { id: true, name: true, slug: true },
      }),
    ]);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_confirmation_enrich" },
    });
    return confirmations;
  }

  const coworkerById = new Map(coworkers.map((c) => [c.id.toLowerCase(), c]));
  const orgById = new Map(organizations.map((o) => [o.id.toLowerCase(), o]));

  return confirmations.map((confirmation) => {
    const matches = findUuidMatches(confirmation.summary);
    if (matches.length === 0) return confirmation;
    const seen = new Set<string>();
    const refCoworkers: HermesPendingConfirmation["referencedCoworkers"] = [];
    const refOrgs: HermesPendingConfirmation["referencedOrganizations"] = [];
    for (const raw of matches) {
      const id = raw.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const coworker = coworkerById.get(id);
      if (coworker) {
        refCoworkers.push(coworker);
        continue;
      }
      const organization = orgById.get(id);
      if (organization) {
        refOrgs.push(organization);
      }
    }
    return {
      ...confirmation,
      referencedCoworkers: refCoworkers,
      referencedOrganizations: refOrgs,
    };
  });
}

function mapComposioError(error: unknown, fallback: string): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof ComposioConfigError) {
    throw serviceUnavailable("Integrations are not configured on this server.");
  }
  if (error instanceof ComposioApiError) {
    Sentry.captureException(error, {
      tags: { context: "composio", composio_status: String(error.httpStatus) },
      extra: { body: error.body },
    });
    if (error.httpStatus >= 500) {
      throw serviceUnavailable(`${fallback}: ${error.message}`);
    }
    if (
      error.httpStatus === 401 ||
      error.httpStatus === 403 ||
      error.httpStatus === 429
    ) {
      throw serviceUnavailable("Integrations are temporarily unavailable.");
    }
    throw badRequest(error.message);
  }
  throw internalServerError(fallback);
}

function isTransientOrchestratorError(error: HermesOrchestratorError): boolean {
  return (
    error.code === "HERMES_ORCH_UNREACHABLE" ||
    error.httpStatus === 502 ||
    error.httpStatus === 503 ||
    error.httpStatus === 504
  );
}

function mapOrchestratorError(error: unknown, fallback: string): never {
  if (error instanceof HTTPException) {
    throw error;
  }

  if (error instanceof HermesOrchestratorError) {
    if (error.httpStatus >= 500) {
      throw serviceUnavailable(`${fallback}: ${error.message}`, {
        reportToSentry: !isTransientOrchestratorError(error),
      });
    }

    // Auth / permission / rate-limit responses from the orchestrator reflect Core's
    // integration (token, quotas), not the end user's request — avoid 400.
    if (
      error.httpStatus === 401 ||
      error.httpStatus === 403 ||
      error.httpStatus === 429
    ) {
      throw serviceUnavailable("Your assistant is temporarily unavailable.");
    }

    throw badRequest(error.message);
  }

  throw internalServerError(fallback);
}

async function upsertHermesInstanceForUser(
  userId: string,
  data?: { assistantName?: string; avatarSeed?: string | null },
): Promise<void> {
  await ensureOrchestratorForUser(userId, {
    ...(data?.assistantName !== undefined ? { name: data.assistantName } : {}),
    ...(data?.avatarSeed !== undefined ? { avatarSeed: data.avatarSeed } : {}),
  });
}

/** Statuses that mean the orch instance was just created, not a live agent. */
const FRESH_PROVISION_STATUSES = new Set<HermesInstanceStatus>([
  "provisioning",
  "infrastructure_ready",
]);

/**
 * True when post-provision state is a brand-new instance we may safely wipe
 * zombie local rows for. Ready/running (or already onboarded) must never
 * trigger a chat wipe — a false pre-check `instance_not_found` plus an
 * idempotent provision against a live orch instance would otherwise delete
 * real history.
 */
function isFreshProvisionInstance(instance: {
  status: HermesInstanceStatus;
  onboardedAt: string | null;
}): boolean {
  return (
    instance.onboardedAt == null &&
    FRESH_PROVISION_STATUSES.has(instance.status)
  );
}

interface HermesInstanceMeta {
  assistantName: string | null;
  avatarSeed: string | null;
}

/**
 * Reads the Sokosumi-side display metadata (assistant name + orb avatar seed)
 * for a user. These are supplementary display fields the orchestrator knows
 * nothing about. Returns nulls on any read failure (e.g. a column-adding
 * migration not yet applied, or a transient DB blip) so it never takes down
 * the whole instance fetch — the assistant still loads with fallbacks.
 */
async function readHermesInstanceMeta(
  userId: string,
): Promise<HermesInstanceMeta> {
  try {
    const row = await prisma.orchestrator.findFirst({
      where: { userId, archivedAt: null },
      select: { name: true, avatarSeed: true },
    });
    return {
      assistantName: row?.name ?? null,
      avatarSeed: row?.avatarSeed ?? null,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_read_instance_meta" },
    });
    return { assistantName: null, avatarSeed: null };
  }
}

interface HermesPersonalityValues {
  tone: number;
  detail: number;
  style: number;
}

/**
 * Persists the chosen personality (the Sokosumi-side mirror of what's
 * forwarded to the orchestrator) so the chat UI can reflect it. Resilient on
 * its own: a write failure (e.g. the personality columns' migration not yet
 * applied) is swallowed so it never fails onboarding — the agent still starts,
 * the chat just falls back to a calm default orb.
 */
async function persistHermesPersonality(
  userId: string,
  personality: HermesPersonalityValues,
): Promise<void> {
  const patch = {
    personalityTone: personality.tone,
    personalityDetail: personality.detail,
    personalityStyle: personality.style,
  };
  try {
    await ensureOrchestratorForUser(userId, {
      personalityTone: patch.personalityTone,
      personalityDetail: patch.personalityDetail,
      personalityStyle: patch.personalityStyle,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_persist_personality" },
    });
  }
}

/**
 * Reads the chosen personality back. Kept as its own query + try/catch
 * (separate from readHermesInstanceMeta) so that if the personality columns'
 * migration hasn't been applied, the failure stays isolated to personality and
 * does NOT null out the assistant name / orb seed. Returns null when unset or
 * on any read failure.
 */
async function readHermesInstancePersonality(
  userId: string,
): Promise<HermesPersonalityValues | null> {
  try {
    const row = await prisma.orchestrator.findFirst({
      where: { userId, archivedAt: null },
      select: {
        personalityTone: true,
        personalityDetail: true,
        personalityStyle: true,
      },
    });
    if (
      !row ||
      row.personalityTone === null ||
      row.personalityDetail === null ||
      row.personalityStyle === null
    ) {
      return null;
    }
    return {
      tone: row.personalityTone,
      detail: row.personalityDetail,
      style: row.personalityStyle,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_read_instance_personality" },
    });
    return null;
  }
}

/**
 * Convenience for the instance-response merge points: the display metadata
 * (name + orb seed) plus the personality, each read resiliently and in
 * parallel. Spread over the orchestrator instance before Zod parsing.
 */
async function readHermesInstanceDisplay(
  userId: string,
): Promise<
  HermesInstanceMeta & { personality: HermesPersonalityValues | null }
> {
  const [meta, personality] = await Promise.all([
    readHermesInstanceMeta(userId),
    readHermesInstancePersonality(userId),
  ]);
  return { ...meta, personality };
}

/**
 * Stable namespace UUID for deriving HermesMessage ids from welcome-event
 * tuples. Bound to this codebase; do NOT change without a migration plan
 * (it shifts every existing welcome's deterministic id).
 */
const HERMES_WELCOME_UUID_NAMESPACE = "f4e5b2cd-1c1a-4d8a-9a2e-7c1ad1b8d5a9";

/**
 * Stable namespace UUID for deriving HermesMessage ids from resolved
 * confirmation cards. Same do-not-change contract as the welcome namespace.
 */
const HERMES_CONFIRMATION_CARD_UUID_NAMESPACE =
  "0b6f3a41-8d2e-4f7c-9b5a-2e4c8d1f6a73";

/** `HermesMessage.kind` for a persisted resolved-confirmation audit card. */
const HERMES_CONFIRMATION_CARD_KIND = "confirmation_card";

/**
 * Persists a resolved confirmation as a `confirmation_card` message so the
 * approve/reject audit trail survives a reload. Without this the resolved
 * card only lives in tab-local React state — closing the tab silently
 * erases the record of what the user approved and into which workspace.
 *
 * Idempotent via a deterministic UUIDv5 id derived from
 * `(userId, confirmationId)` — a double-click or a retried request lands on
 * the same row (`update: {}` no-op). Best-effort by design: a persistence
 * failure must never fail the resolve that already happened.
 */
async function persistHermesConfirmationCard(args: {
  userId: string;
  confirmation: HermesPendingConfirmation;
  status: "approved" | "rejected" | "already_resolved";
  /** Final workspace the tool call ran in (override, else Hermes' proposal).
   * `null` = personal scope. */
  organizationId: string | null;
  organizationName: string | null;
}): Promise<void> {
  try {
    // Resolve referenced coworker/org UUIDs now so the persisted card can
    // render name chips after a reload, when the live enriched confirmation
    // is long gone from the orchestrator's pendingConfirmations.
    const [enriched] = await enrichPendingConfirmations(
      [args.confirmation],
      args.userId,
    );
    const confirmation = enriched ?? args.confirmation;
    const id = uuidv5(
      `${args.userId}:confirmation-card:${confirmation.id}`,
      HERMES_CONFIRMATION_CARD_UUID_NAMESPACE,
    );
    await prisma.hermesMessage.upsert({
      where: { id },
      create: {
        id,
        userId: args.userId,
        role: "assistant",
        kind: HERMES_CONFIRMATION_CARD_KIND,
        content: JSON.stringify({
          confirmationId: confirmation.id,
          toolName: confirmation.toolName,
          summary: confirmation.summary,
          status: args.status,
          organizationId: args.organizationId,
          organizationName: args.organizationName,
          referencedCoworkers: confirmation.referencedCoworkers,
          referencedOrganizations: confirmation.referencedOrganizations,
          confirmationCreatedAt: confirmation.createdAt,
        }),
      },
      update: {},
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_confirmation_card_persist" },
      extra: { userId: args.userId, confirmationId: args.confirmation.id },
    });
  }
}

/**
 * Best-effort snapshot of a pending confirmation just before it is resolved
 * — the orchestrator drops it from `pendingConfirmations` on resolve.
 * Returns null on miss/failure; callers may fall back to a minimal
 * id-matched card so the audit trail still lands without trusting client
 * display fields.
 */
async function snapshotPendingConfirmation(
  userId: string,
  confirmationId: string,
): Promise<HermesPendingConfirmation | null> {
  try {
    const instance = await getInstance(userId);
    return (
      instance?.pendingConfirmations.find((p) => p.id === confirmationId) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Prefer the orchestrator pending-list snapshot. When it is gone, accept a
 * client payload only to prove `id` matches the path param, then persist a
 * minimal card — never client `summary` / `toolName` / refs / org labels
 * (those are attacker-controlled for the user's own history otherwise).
 */
function resolveConfirmationForAudit(
  confirmationId: string,
  orchSnapshot: HermesPendingConfirmation | null,
  clientSnapshot: HermesPendingConfirmation | undefined,
): HermesPendingConfirmation | null {
  if (orchSnapshot) return orchSnapshot;
  if (clientSnapshot?.id !== confirmationId) return null;
  return {
    id: confirmationId,
    toolName: "gated_action",
    summary: "Confirmation resolved",
    createdAt: new Date().toISOString(),
    referencedCoworkers: [],
    referencedOrganizations: [],
    organizationId: null,
    organizationName: null,
  };
}

/**
 * Per-process memo of welcome ids we've already persisted this lifetime.
 * GET /me/instance is on the hot polling path; without this every poll
 * would issue a (no-op but real) upsert round-trip to Postgres for users
 * whose welcome is long since written. The upsert is the correctness
 * floor; this is the latency optimization.
 *
 * Cold starts / horizontally-scaled instances each have their own memo —
 * worst case we issue one extra upsert per process per user. Acceptable.
 */
const persistedWelcomeIds = new Set<string>();

/**
 * Persist the orchestrator's one-shot welcome into our local message log.
 *
 * Idempotent via a deterministic UUIDv5 id derived from
 * `(userId, onboardedAtIso, kind)`. We use `upsert` so two concurrent GET
 * /me/instance polls that race the existence check both end up at the same
 * row — the second insert is a no-op (`update: {}`) instead of duplicating.
 *
 * Previously this did `findFirst` then `create` without a transaction or
 * unique constraint, which let two concurrent polls each pass the check
 * and double-insert the welcome.
 */
async function persistHermesWelcomeMessage(args: {
  userId: string;
  content: string;
  kind: string | null;
  onboardedAtIso: string;
}): Promise<void> {
  // Fall back to "now" if the orchestrator handed us a malformed timestamp
  // (and tell Sentry about it) — the previous behaviour was to silently
  // drop the welcome message entirely, leaving the user with an empty chat
  // on first open and no signal that anything was wrong.
  let createdAt = new Date(args.onboardedAtIso);
  if (Number.isNaN(createdAt.getTime())) {
    Sentry.captureMessage("hermes_welcome_bad_onboarded_at", {
      level: "warning",
      tags: { context: "hermes_welcome_persist" },
      extra: { userId: args.userId, onboardedAtIso: args.onboardedAtIso },
    });
    createdAt = new Date();
  }

  const id = uuidv5(
    `${args.userId}:${args.onboardedAtIso}:${args.kind ?? "none"}`,
    HERMES_WELCOME_UUID_NAMESPACE,
  );

  // Already persisted in this process — skip the DB round-trip on the hot
  // polling path. The first poll after a process start still pays the
  // upsert cost; everything after that is in-memory.
  if (persistedWelcomeIds.has(id)) return;

  await prisma.hermesMessage.upsert({
    where: { id },
    create: {
      id,
      userId: args.userId,
      role: "assistant",
      content: args.content,
      kind: args.kind,
      createdAt,
    },
    // Already persisted — leave it alone. We rely on the primary-key
    // conflict to coalesce concurrent inserts atomically.
    update: {},
  });

  persistedWelcomeIds.add(id);
}

interface HermesChatTranscriptTurn {
  userId: string;
  userMessageId: string;
  assistantMessageId: string;
  userContent: string;
  assistantContent: string;
  /** Tool/progress steps captured during a streamed turn (stored on the
   * assistant message so the UI's steps disclosure survives a reload). */
  assistantSteps?: {
    kind: "tool" | "reasoning";
    label: string;
    detail?: string;
  }[];
  /** Total wall-clock time of the streamed turn (ms), persisted so the
   * "Answered in Ns" stamp survives a reload. */
  assistantDurationMs?: number;
}

async function persistHermesChatTranscript(
  turn: HermesChatTranscriptTurn,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.hermesMessage.upsert({
      where: { id: turn.userMessageId },
      create: {
        id: turn.userMessageId,
        userId: turn.userId,
        role: "user",
        content: turn.userContent,
      },
      update: {},
    });
    await tx.hermesMessage.upsert({
      where: { id: turn.assistantMessageId },
      create: {
        id: turn.assistantMessageId,
        userId: turn.userId,
        role: "assistant",
        content: turn.assistantContent,
        steps: turn.assistantSteps as Prisma.InputJsonValue | undefined,
        durationMs: turn.assistantDurationMs,
      },
      update: {},
    });
  });
}

async function persistHermesChatTranscriptWithRetries(
  turn: HermesChatTranscriptTurn,
  delaysMs: readonly number[],
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  for (const delayMs of delaysMs) {
    if (options.signal?.aborted) return false;
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
      if (options.signal?.aborted) return false;
    }

    try {
      await persistHermesChatTranscript(turn);
      return true;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { context: "hermes_chat_transcript_persist" },
        extra: { userId: turn.userId },
      });
    }
  }

  return false;
}

function scheduleHermesChatTranscriptRecovery(
  turn: HermesChatTranscriptTurn,
): void {
  waitUntil(
    persistHermesChatTranscriptWithRetries(turn, CHAT_RECOVERY_RETRY_DELAYS_MS),
  );
}

/** In-flight streamed-turn persistence per user. The next /chat or /chat/stream
 * awaits this so conversation history includes the prior turn before Hermes runs. */
const hermesStreamTurnPersistByUser = new Map<string, Promise<void>>();

async function awaitPriorHermesStreamPersistence(
  userId: string,
): Promise<void> {
  const pending = hermesStreamTurnPersistByUser.get(userId);
  if (!pending) return;
  await pending.catch(() => {
    // Prior capture may have failed; proceed with whatever was persisted.
  });
}

function trackHermesStreamTurnPersistence(
  userId: string,
  promise: Promise<void>,
): void {
  hermesStreamTurnPersistByUser.set(userId, promise);
  void promise.finally(() => {
    if (hermesStreamTurnPersistByUser.get(userId) === promise) {
      hermesStreamTurnPersistByUser.delete(userId);
    }
  });
}

async function recoverHermesInboxAfterChatFailure(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Awaited<ReturnType<typeof syncHermesInboxForUser>> | null> {
  try {
    return await syncHermesInboxForUser(userId, { signal: options.signal });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_chat_inbox_recovery" },
      extra: { userId },
    });
    return null;
  }
}

async function recoverHermesInboxAfterChatFailureWithRetries(
  userId: string,
): Promise<void> {
  for (const delayMs of CHAT_RECOVERY_RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const outcome = await recoverHermesInboxAfterChatFailure(userId);
    if (outcome?.outcome === "messages" && (outcome.count ?? 0) > 0) return;
  }
}

async function recoverHermesInboxAfterFailedChatRequest(
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const outcome = await recoverHermesInboxAfterChatFailure(userId, { signal });
  if (outcome?.outcome === "messages" && (outcome.count ?? 0) > 0) return;

  waitUntil(recoverHermesInboxAfterChatFailureWithRetries(userId));
}

const postChatRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/chat",
    description: "Send a message to the current user's assistant instance",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesChatRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesChatResponseSchema,
        "assistant chat response. The assistant message is returned as data.message.",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonSuccessResponse(
        hermesInstanceNotReadySchema,
        "assistant instance is not ready. Uses the standard data/meta envelope with only data.status.",
      ),
      413: jsonErrorResponse("Payload Too Large"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const getInstanceRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance",
    description: "Get the current user's assistant instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesGetInstanceEnvelopeSchema,
        "assistant instance (data.instance is null when none exists)",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const provisionInstanceRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance",
    description: "Provision the current user's assistant instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(hermesInstanceSchema, "assistant instance"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const updateInstanceRoute = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/me/instance",
    description:
      "Update mutable fields (autonomyLevel, name, email) on the current user's assistant instance",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesUpdateInstanceRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesInstanceSchema,
        "Updated assistant instance",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const destroyInstanceRoute = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/me/instance",
    description: "Destroy the current user's assistant instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "assistant instance destroyed",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const listMessagesRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/messages",
    description: "List the current user's persisted assistant messages",
    tags: TAGS,
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(hermesPersistedMessageSchema),
        "assistant messages",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

const getUnreadCountRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/unread-count",
    description: "Get the current user's unread assistant inbox count",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(hermesUnreadCountSchema, "Hermes unread count"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

const markInboxSeenRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/inbox/seen",
    description: "Mark current user's assistant inbox messages as seen",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: markHermesInboxSeenRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "assistant inbox marked seen",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

const setSecretRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/secrets",
    description: "Set a secret on the current user's assistant instance",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: setHermesSecretRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "assistant secret set",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

// ─── Onboarding v2 routes ─────────────────────────────────────────────────

const startOnboardingRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/onboard",
    description:
      "Kick off the orchestrator's onboarding flow (research-intro + boot prompt)",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesStartOnboardingRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "Onboarding kicked off; poll /me/instance and /me/instance/onboarding-progress",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const getOnboardingProgressRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/onboarding-progress",
    description: "Get step-by-step onboarding progress for the loader UI",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesOnboardingProgressSchema,
        "Onboarding progress",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const listIntegrationsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/integrations",
    description: "List the current user's connected assistant integrations",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesIntegrationsListResponseSchema,
        "Connected integrations",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const listSchedulesRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/schedules",
    description:
      "List orchestrator-managed and Hermes-side scheduled tasks for this user (workspace sync, daily briefs, etc.)",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesSchedulesListResponseSchema,
        "Scheduled tasks",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const patchScheduleRoute = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/me/instance/schedules/{scheduleId}",
    description:
      "Update a scheduled task (currently just toggle `enabled`). Orchestrator resyncs the user-local cron on next request.",
    tags: TAGS,
    request: {
      params: z.object({
        scheduleId: z.string().min(1),
      }),
      body: {
        content: {
          "application/json": {
            schema: hermesPatchScheduleRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(hermesScheduleSchema, "Updated schedule"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const approveConfirmationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/confirmations/{confirmationId}/approve",
    description:
      "Approve a medium-autonomy pending tool call. Optional org overrides reroute or clear the queued tool args.",
    tags: TAGS,
    request: {
      params: z.object({
        confirmationId: z.string().min(1),
      }),
      body: {
        required: false,
        content: {
          "application/json": {
            schema: hermesApproveConfirmationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesConfirmationResolveResponseSchema,
        "Confirmation resolved",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const rejectConfirmationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/confirmations/{confirmationId}/reject",
    description:
      "Reject a medium-autonomy pending tool call. Optional `reason` is shown to Hermes on its next turn.",
    tags: TAGS,
    request: {
      params: z.object({
        confirmationId: z.string().min(1),
      }),
      body: {
        content: {
          "application/json": {
            schema: hermesRejectConfirmationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesConfirmationResolveResponseSchema,
        "Confirmation rejected",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const disconnectIntegrationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/me/instance/integrations/{provider}",
    description: "Disconnect a third-party provider",
    tags: TAGS,
    request: {
      params: z.object({
        provider: hermesIntegrationProviderSchema,
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "Integration disconnected",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const initiateIntegrationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/integrations/initiate",
    description:
      "Start the Composio-hosted OAuth flow for a provider. Returns the URL the client should open in a popup.",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesInitiateIntegrationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesInitiateIntegrationResponseSchema,
        "OAuth flow initiated",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const finalizeIntegrationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/integrations/finalize",
    description:
      "Finalize a Composio OAuth flow: confirm the connection is ACTIVE and register the MCP URL with the orchestrator.",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesFinalizeIntegrationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesIntegrationSchema,
        "Integration finalized",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const app = new OpenAPIHonoWithAuth();

// Access posture: web navigation/page access is beta-gated to whitelisted
// email domains (apps/web hermes beta-access); the Core API itself stays
// available to authenticated users. Activating and using (chat, onboard,
// settings mutations, skills) require paid coverage (or admin). Destroy /
// purge / GET reads stay ungated so cancelled users can still see history
// and tear down.
app.openapi(postChatRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const body = c.req.valid("json");
  const userContent = typeof body.content === "string" ? body.content : "";
  const trimmed = userContent.trim();
  const files = validateAndDecodeFiles(body.files);

  if (!trimmed && files.length === 0) {
    throw badRequest("Message content or at least one file is required.");
  }

  if (Buffer.byteLength(trimmed, "utf8") > MAX_USER_CONTENT_BYTES) {
    throw payloadTooLarge("Message content is too large.");
  }

  await awaitPriorHermesStreamPersistence(userContext.userId);

  const historyNewestFirst = await prisma.hermesMessage.findMany({
    // Resolved-confirmation audit cards are UI artifacts (JSON snapshots for
    // the read-only card render), not conversation — excluding them keeps
    // machine-format JSON out of the model's context and stops each card
    // from consuming a history slot. The OR shape is deliberate: a plain
    // `kind: { not: ... }` would also drop the kind-null rows (regular chat
    // turns) under SQL null semantics.
    where: {
      userId: userContext.userId,
      OR: [{ kind: null }, { kind: { not: HERMES_CONFIRMATION_CARD_KIND } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_CHAT_CONTEXT_MESSAGES,
    select: { role: true, content: true },
  });
  const history = historyNewestFirst.slice().reverse();
  const conversation: OutboundChatMessage[] = [
    ...history
      .filter((message) => isValidRole(message.role))
      .map((message) => ({
        role: message.role as "user" | "assistant" | "system",
        content: message.content,
      })),
    buildUserMessageForHermes(trimmed, files),
  ];

  try {
    await ensureInstanceReady(userContext.userId);
  } catch (error) {
    if (error instanceof HermesInstanceNotReadyError) {
      return conflictWithData(c, { status: error.status });
    }

    return mapOrchestratorError(error, "Failed to prepare assistant instance");
  }

  const persistedUserContent = buildPersistedUserContent(trimmed, files);

  let upstream: Response;
  try {
    upstream = await proxyChatCompletions(userContext.userId, {
      model: "hermes-agent",
      messages: conversation,
      stream: false,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    Sentry.captureException(error, {
      tags: { context: "hermes_proxy_fetch" },
      extra: { userId: userContext.userId },
    });
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    throw serviceUnavailable("Your assistant is temporarily unavailable.");
  }

  if (upstream.status >= 500) {
    Sentry.captureMessage("hermes_proxy_5xx", {
      level: "warning",
      tags: { status: String(upstream.status) },
    });
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    throw serviceUnavailable("Your assistant is temporarily unavailable.");
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    throw badRequest(text || "Your assistant rejected the chat request.");
  }

  const parsed = (await upstream
    .json()
    .catch(() => null)) as OpenAIChatResponse | null;
  const content =
    typeof parsed?.choices?.[0]?.message?.content === "string"
      ? parsed.choices[0].message.content
      : "";

  if (!content) {
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    throw serviceUnavailable("Your assistant returned an empty response.");
  }

  const transcriptTurn: HermesChatTranscriptTurn = {
    userId: userContext.userId,
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID(),
    userContent: persistedUserContent,
    assistantContent: content,
  };

  const transcriptPersisted = await persistHermesChatTranscriptWithRetries(
    transcriptTurn,
    CHAT_TRANSCRIPT_INLINE_RETRY_DELAYS_MS,
    { signal: c.req.raw.signal },
  );
  if (!transcriptPersisted) {
    // Hermes already executed this turn. A 503 would invite client retries
    // (duplicate upstream work). Inbox sync only ingests orchestrator outbox
    // traffic, not synchronous /chat turns — retry the local transcript directly.
    scheduleHermesChatTranscriptRecovery(transcriptTurn);
  }

  return ok(
    c,
    hermesChatResponseSchema.parse({
      message: { role: "assistant", content },
    }),
  );
});

interface CapturedTurn {
  content: string;
  steps: { kind: "tool" | "reasoning"; label: string; detail?: string }[];
}

/**
 * Reads a streamed OpenAI-compatible SSE response to completion, capturing the
 * assistant text and the `hermes.status` tool steps. Run server-side on one
 * branch of a tee()'d stream and decoupled from the client connection (see
 * /chat/stream), so a turn is captured + persisted even if the user closes the
 * tab mid-stream. Parsing is best-effort; malformed frames are skipped.
 */
export async function captureFromStream(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal } = {},
): Promise<CapturedTurn> {
  const { signal } = options;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const steps: {
    kind: "tool" | "reasoning";
    label: string;
    detail?: string;
  }[] = [];

  const snapshot = (): CapturedTurn => ({ content, steps });

  const consumeFrame = (rawFrame: string): void => {
    let event: string | null = null;
    const dataLines: string[] = [];
    for (const line of rawFrame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    if (data === "[DONE]") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return; // keepalive / non-JSON frame
    }
    if (event === "hermes.status") {
      const status = json as {
        phase?: string;
        label?: string;
        detail?: string;
      };
      if (status.phase === "tool" && typeof status.label === "string") {
        steps.push({
          kind: "tool",
          label: status.label,
          detail: status.detail,
        });
      } else if (
        status.phase === "reasoning" &&
        typeof status.detail === "string"
      ) {
        steps.push({ kind: "reasoning", label: status.detail });
      }
      return;
    }
    const chunk = json as {
      choices?: Array<{ delta?: { content?: string | null } }>;
    };
    const piece = chunk.choices?.[0]?.delta?.content;
    if (typeof piece === "string") content += piece;
  };

  const abortCapture = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abortCapture, { once: true });

  try {
    if (signal?.aborted) return snapshot();

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted) break;
        throw error;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        consumeFrame(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");
      }
      if (signal?.aborted) break;
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") consumeFrame(buffer);
  } finally {
    signal?.removeEventListener("abort", abortCapture);
    reader.releaseLock();
  }

  return snapshot();
}

/**
 * POST /hermes/chat/stream — streaming sibling of POST /chat.
 *
 * Opt-in: clients that can parse SSE and branch on the `event:` field call this
 * instead of /chat. We forward `stream: true` + `X-Hermes-Progress: 1` to the
 * orchestrator and pass its SSE body straight through (OpenAI chat chunks
 * interleaved with `event: hermes.status` progress frames), capturing the
 * assistant text on the side to persist the transcript when the stream ends.
 * Not an OpenAPI route — the response is an event stream, not a JSON envelope.
 */
app.post("/chat/stream", async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);

  const rawJson = await c.req.json().catch(() => null);
  const parsed = hermesChatRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw badRequest("Invalid chat request body.");
  }

  const userContent =
    typeof parsed.data.content === "string" ? parsed.data.content : "";
  const trimmed = userContent.trim();
  const files = validateAndDecodeFiles(parsed.data.files);

  if (!trimmed && files.length === 0) {
    throw badRequest("Message content or at least one file is required.");
  }
  if (Buffer.byteLength(trimmed, "utf8") > MAX_USER_CONTENT_BYTES) {
    throw payloadTooLarge("Message content is too large.");
  }

  await awaitPriorHermesStreamPersistence(userContext.userId);

  const historyNewestFirst = await prisma.hermesMessage.findMany({
    // Resolved-confirmation audit cards are UI artifacts (JSON snapshots for
    // the read-only card render), not conversation — excluding them keeps
    // machine-format JSON out of the model's context and stops each card
    // from consuming a history slot. The OR shape is deliberate: a plain
    // `kind: { not: ... }` would also drop the kind-null rows (regular chat
    // turns) under SQL null semantics.
    where: {
      userId: userContext.userId,
      OR: [{ kind: null }, { kind: { not: HERMES_CONFIRMATION_CARD_KIND } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_CHAT_CONTEXT_MESSAGES,
    select: { role: true, content: true },
  });
  const history = historyNewestFirst.slice().reverse();
  const conversation: OutboundChatMessage[] = [
    ...history
      .filter((message) => isValidRole(message.role))
      .map((message) => ({
        role: message.role as "user" | "assistant" | "system",
        content: message.content,
      })),
    buildUserMessageForHermes(trimmed, files),
  ];

  try {
    await ensureInstanceReady(userContext.userId);
  } catch (error) {
    if (error instanceof HermesInstanceNotReadyError) {
      return conflictWithData(c, { status: error.status });
    }
    return mapOrchestratorError(error, "Failed to prepare Hermes instance");
  }

  const persistedUserContent = buildPersistedUserContent(trimmed, files);
  const turnStart = Date.now();

  // Server-owned abort with a generous cap so a wedged orchestrator stream
  // can't leak forever. We deliberately do NOT forward the client's request
  // signal: a closed tab must not abort generation, so the turn is still
  // captured + persisted (see the tee below). This abort only stops the
  // upstream fetch/read — transcript persistence runs without it so partial
  // turns captured before the cap still land in history.
  const fetchAbort = new AbortController();
  const captureTimeout = setTimeout(() => fetchAbort.abort(), 5 * 60_000);

  let upstream: Response;
  try {
    upstream = await proxyChatCompletions(
      userContext.userId,
      { model: "hermes-agent", messages: conversation, stream: true },
      {
        headers: { "X-Hermes-Progress": "1", Accept: "text/event-stream" },
        signal: fetchAbort.signal,
      },
    );
  } catch (error) {
    clearTimeout(captureTimeout);
    if (error instanceof HTTPException) {
      throw error;
    }
    Sentry.captureException(error, {
      tags: { context: "hermes_proxy_stream_fetch" },
      extra: { userId: userContext.userId },
    });
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    throw serviceUnavailable("Hermes is temporarily unavailable.");
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(captureTimeout);
    const text = upstream.body ? await upstream.text().catch(() => "") : "";
    Sentry.captureMessage("hermes_proxy_stream_not_ok", {
      level: "warning",
      tags: { status: String(upstream.status) },
    });
    await recoverHermesInboxAfterFailedChatRequest(
      userContext.userId,
      c.req.raw.signal,
    );
    if (upstream.status >= 500 || !upstream.body) {
      throw serviceUnavailable("Hermes is temporarily unavailable.");
    }
    throw badRequest(text || "Hermes rejected the chat request.");
  }

  const persistTurn = async (captured: CapturedTurn): Promise<void> => {
    const content = captured.content.trim();
    if (!content) {
      await recoverHermesInboxAfterFailedChatRequest(
        userContext.userId,
        c.req.raw.signal,
      );
      return;
    }
    const transcriptTurn: HermesChatTranscriptTurn = {
      userId: userContext.userId,
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
      userContent: persistedUserContent,
      assistantContent: content,
      assistantSteps: captured.steps.length > 0 ? captured.steps : undefined,
      assistantDurationMs: Date.now() - turnStart,
    };
    const persisted = await persistHermesChatTranscriptWithRetries(
      transcriptTurn,
      CHAT_TRANSCRIPT_INLINE_RETRY_DELAYS_MS,
    );
    if (!persisted) {
      scheduleHermesChatTranscriptRecovery(transcriptTurn);
    }
  };

  // Tee the upstream: one branch streams to the client, the other is drained
  // server-side to capture + persist the turn — independent of whether the
  // client stays connected. The capture branch drives the orchestrator stream
  // to completion even if the user closes the tab mid-answer.
  const [toClient, toCapture] = upstream.body.tee();
  const captureAndPersist = (async () => {
    try {
      const captured = await captureFromStream(toCapture, {
        signal: fetchAbort.signal,
      });
      await persistTurn(captured);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { context: "hermes_stream_capture" },
        extra: { userId: userContext.userId },
      });
      await recoverHermesInboxAfterFailedChatRequest(
        userContext.userId,
        c.req.raw.signal,
      );
    }
  })();
  trackHermesStreamTurnPersistence(userContext.userId, captureAndPersist);
  waitUntil(captureAndPersist.finally(() => clearTimeout(captureTimeout)));

  return new Response(toClient, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

app.openapi(getInstanceRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);

  try {
    const instance = await getInstance(userContext.userId);
    if (instance) {
      await upsertHermesInstanceForUser(userContext.userId).catch((error) => {
        Sentry.captureException(error, {
          tags: { context: "hermes_instance_backfill" },
        });
      });

      // Resolve any coworker / organization UUIDs the orchestrator inlined
      // into confirmation summaries BEFORE we hand the instance to Zod —
      // the schema's `referencedCoworkers` field expects the enriched shape.
      const enrichedConfirmations = await enrichPendingConfirmations(
        instance.pendingConfirmations,
        userContext.userId,
      );
      const meta = await readHermesInstanceDisplay(userContext.userId);
      const parsedInstance = hermesInstanceSchema.parse({
        ...instance,
        ...meta,
        pendingConfirmations: enrichedConfirmations,
      });

      // Atomic welcome (orchestrator's "ready" payload carries the intro).
      // Persist it on first sight so the chat opens with the welcome
      // already rendered via the existing message-fetch path — no separate
      // poll-and-drain race. Awaited deliberately: the client typically
      // fetches messages immediately after seeing `status === "ready"`,
      // so persisting in the background would let the first fetch return
      // an empty inbox and flash empty chat. Only when `onboardedAt` is a
      // valid ISO timestamp (normalized in `getInstance`) — a truthy but
      // malformed value must not persist-then-500 the handler.
      if (instance.welcomeMessage && parsedInstance.onboardedAt) {
        try {
          await persistHermesWelcomeMessage({
            userId: userContext.userId,
            content: instance.welcomeMessage,
            kind: instance.welcomeKind,
            onboardedAtIso: parsedInstance.onboardedAt,
          });
        } catch (error) {
          Sentry.captureException(error, {
            tags: { context: "hermes_welcome_persist" },
          });
        }
      }

      return ok(
        c,
        hermesGetInstanceEnvelopeSchema.parse({
          hasInstance: true,
          instance: parsedInstance,
        }),
      );
    }

    // The orchestrator has no instance for this user. Deliberately NO local
    // cleanup here: auto-deleting the mirror rows (chat history, assistant
    // name, orb seed) on this signal means one wrong instance_not_found from
    // the orchestrator irreversibly wipes real user data. Orchestrator-side
    // deletions instead call POST /orchestrators/me/purge explicitly.
    return ok(c, hermesGetInstanceEnvelopeSchema.parse({ hasInstance: false }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to fetch assistant instance");
  }
});

/**
 * True when the user has assistant-plan coverage: a subscription of Standard
 * or better on their personal reference or on any organization they belong to.
 * The web app's subscription wall gates on the session's active workspace;
 * this is the API-level floor beneath it — Better Auth API keys and OAuth
 * access tokens mint plain user auth contexts, so the Core route must enforce
 * the plan itself rather than trusting the web action's check.
 */
async function userHasAssistantPlanCoverage(userId: string): Promise<boolean> {
  // Personal Stripe subscription (user as referenceId).
  const personal =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      userId,
      prisma,
    );
  if (planUnlocksPersonalAssistant(personal?.plan)) return true;

  // Org memberships via the canonical billing-plan resolver (enterprise
  // contract first, then self-serve Stripe). Enterprise orgs often have no
  // subscription row at all — the old Stripe-only loop missed them.
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  for (const { organizationId } of memberships) {
    const billingPlan = await resolveOrganizationBillingPlan(
      organizationId,
      prisma,
    );
    // Match the canonical coverage checks (organization-subscription-auth,
    // seat service): an "active" contract past its commercial term is not
    // consumable and must not grant assistant access.
    if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable)
      return true;
    if (
      billingPlan.mode === "self_serve" &&
      planUnlocksPersonalAssistant(billingPlan.plan)
    )
      return true;
  }
  return false;
}

/**
 * Enforce Standard-or-better coverage for activating and using the personal
 * assistant. Admins are exempt. Reads (GET instance / messages / unread) stay
 * open so the UI can still show history and the subscription wall; destroy
 * stays open so downgraded users can tear the instance down.
 */
async function requireAssistantPlanCoverage(userContext: {
  userId: string;
  role: string | null | undefined;
}): Promise<void> {
  if (hasAdminRole(userContext.role)) return;
  if (await userHasAssistantPlanCoverage(userContext.userId)) return;
  throw forbidden(
    "A Standard subscription or higher is required to use the personal assistant.",
  );
}

app.openapi(provisionInstanceRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  // Paid-plan gate, mirroring the web action's check (which alone is
  // bypassable by calling this route directly with an API key). Admins are
  // exempt so the team can operate test instances without billing.
  await requireAssistantPlanCoverage(userContext);
  const user = await prisma.user.findUnique({
    where: { id: userContext.userId },
    select: { name: true, email: true },
  });

  try {
    // `provisionInstance` is idempotent — re-POSTing for a live orch
    // instance must NOT wipe chat. A structured pre-check
    // `instance_not_found` can still be wrong; only clear the local mirror
    // when post-provision state is still a fresh early instance. On a
    // pre-check throw, assume an instance exists so we never delete live
    // history by accident.
    let hadOrchestratorInstance = true;
    try {
      hadOrchestratorInstance = (await getInstance(userContext.userId)) != null;
    } catch {
      hadOrchestratorInstance = true;
    }

    await provisionInstance(userContext.userId, {
      name: user?.name,
      email: user?.email,
      sokosumiEnv: resolveSokosumiEnvForOrchestrator(),
    });
    const instance = await getInstance(userContext.userId);

    if (!instance) {
      throw serviceUnavailable(
        "Provision call succeeded but the assistant instance is not visible yet.",
      );
    }

    if (!hadOrchestratorInstance && isFreshProvisionInstance(instance)) {
      await clearHermesLocalMirrorForUser(userContext.userId).catch((error) => {
        Sentry.captureException(error, {
          tags: { context: "hermes_provision_clear_stale_mirror" },
          extra: { userId: userContext.userId },
        });
      });
    }

    // Fail closed: remote instance without a local active orchestrator row
    // breaks task/event attribution and usage. Client should retry provision
    // (idempotent on Hermes). GET instance may still backfill best-effort.
    try {
      await upsertHermesInstanceForUser(userContext.userId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { context: "hermes_instance_upsert" },
        extra: { userId: userContext.userId },
      });
      throw serviceUnavailable(
        "Assistant was provisioned remotely but the local orchestrator instance could not be activated. Retry provision.",
      );
    }

    const meta = await readHermesInstanceDisplay(userContext.userId);
    return ok(c, hermesInstanceSchema.parse({ ...instance, ...meta }));
  } catch (error) {
    return mapOrchestratorError(
      error,
      "Failed to provision assistant instance",
    );
  }
});

app.openapi(updateInstanceRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const body = c.req.valid("json");

  try {
    await patchInstance(userContext.userId, {
      autonomyLevel: body.autonomyLevel,
      name: body.name,
      email: body.email,
      timezone: body.timezone,
    });
    // Assistant name + orb seed are Sokosumi-side metadata — persist them
    // locally rather than forwarding to the orchestrator (whose `name` is
    // the user's name). A null avatarSeed resets to the white placeholder.
    // Best-effort, matching onboard: orch PATCH already succeeded; a local
    // meta write failure must not 500 the request — UI falls back to
    // generic name/orb until the next successful persist.
    if (body.assistantName !== undefined || body.avatarSeed !== undefined) {
      await upsertHermesInstanceForUser(userContext.userId, {
        assistantName: body.assistantName,
        avatarSeed: body.avatarSeed,
      }).catch((error) => {
        Sentry.captureException(error, {
          tags: { context: "hermes_patch_meta_persist" },
          extra: { userId: userContext.userId },
        });
      });
    }
    const instance = await getInstance(userContext.userId);

    if (!instance) {
      throw serviceUnavailable(
        "Update succeeded but the assistant instance is no longer visible.",
      );
    }

    // Always re-merge the persisted name so an unrelated PATCH (e.g. autonomy)
    // doesn't blank it out via the schema's `assistantName` default.
    const meta = await readHermesInstanceDisplay(userContext.userId);
    return ok(c, hermesInstanceSchema.parse({ ...instance, ...meta }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to update assistant instance");
  }
});

app.openapi(destroyInstanceRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);

  try {
    await destroyInstance(userContext.userId);
  } catch (error) {
    return mapOrchestratorError(error, "Failed to destroy assistant instance");
  }

  try {
    await clearHermesLocalMirrorForUser(userContext.userId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_destroy_db_cleanup" },
      extra: { userId: userContext.userId },
    });
    throw serviceUnavailable(
      "Your assistant instance was removed, but we could not clear related data in our system. Please try again shortly; repeating this action is safe.",
    );
  }

  return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
});

app.openapi(listMessagesRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  const queryParams = c.req.valid("query");
  const { cursor, take, skip } = parseCursorPagination(queryParams);
  const takePlusOne = take + 1;
  const where = { userId: userContext.userId };

  const [items, count] = await prisma.$transaction([
    prisma.hermesMessage.findMany({
      where,
      take: takePlusOne,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.hermesMessage.count({ where }),
  ]);
  const hasMore = items.length === takePlusOne;
  const pagedItems = items.slice(0, take);
  const response = pagedItems.map((message) => ({
    id: message.id,
    role: isValidRole(message.role) ? message.role : "assistant",
    content: message.content,
    kind: message.kind,
    steps: message.steps,
    durationMs: message.durationMs,
    createdAt: message.createdAt,
  }));
  const paginationMeta: CursorPaginationMeta = createPaginationMeta(
    pagedItems,
    count,
    take,
    hasMore,
    cursor,
  );

  return ok(
    c,
    z.array(hermesPersistedMessageSchema).parse(response),
    paginationMeta,
  );
});

app.openapi(getUnreadCountRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  const { avatarSeed, assistantName } = await readHermesInstanceMeta(
    userContext.userId,
  );
  const instance = await prisma.orchestrator.findFirst({
    where: { userId: userContext.userId, archivedAt: null },
    select: { lastSeenInboxAt: true },
  });

  if (!instance) {
    return ok(
      c,
      hermesUnreadCountSchema.parse({
        count: 0,
        avatarSeed,
        assistantName,
        hasInstance: false,
      }),
    );
  }

  const count = await prisma.hermesMessage.count({
    where: {
      userId: userContext.userId,
      kind: { not: null },
      ...(instance.lastSeenInboxAt
        ? { createdAt: { gt: instance.lastSeenInboxAt } }
        : {}),
    },
  });

  return ok(
    c,
    hermesUnreadCountSchema.parse({
      count,
      avatarSeed,
      assistantName,
      hasInstance: true,
    }),
  );
});

app.openapi(markInboxSeenRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  const body = c.req.valid("json");
  const target = body.asOfIso ? new Date(body.asOfIso) : new Date();

  if (Number.isNaN(target.getTime())) {
    throw unprocessableEntity("asOfIso must be a valid ISO datetime.");
  }

  const instance = await prisma.orchestrator.findFirst({
    where: { userId: userContext.userId, archivedAt: null },
    select: { lastSeenInboxAt: true },
  });

  if (
    !instance ||
    (instance.lastSeenInboxAt && instance.lastSeenInboxAt >= target)
  ) {
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  }

  await prisma.orchestrator.updateMany({
    where: { userId: userContext.userId, archivedAt: null },
    data: { lastSeenInboxAt: target },
  });

  return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
});

app.openapi(setSecretRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const body = c.req.valid("json");

  if (!isValidSecretKey(body.key)) {
    throw unprocessableEntity(
      "Secret key must match [A-Z_][A-Z0-9_]* (uppercase, digits, underscores).",
    );
  }

  if (isReservedSecretKey(body.key)) {
    throw badRequest(
      `Secret key "${body.key}" is managed by the orchestrator.`,
    );
  }

  if (body.value.length === 0) {
    throw unprocessableEntity("Secret value must not be empty.");
  }

  try {
    await setInstanceSecret(userContext.userId, body.key, body.value);
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to write assistant secret");
  }
});

// ─── Onboarding v2 handlers ───────────────────────────────────────────────

app.openapi(startOnboardingRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const body = c.req.valid("json");

  // Pull name/email from the DB if the client didn't provide them, so the
  // orchestrator's research pass has the best chance of finding context.
  const user = await prisma.user.findUnique({
    where: { id: userContext.userId },
    select: { name: true, email: true },
  });

  try {
    // Persist the user's chosen assistant name + orb avatar seed (Sokosumi-side
    // only) so they're available the moment the chat opens. Not forwarded to
    // the orchestrator. Best-effort, matching persistHermesPersonality below:
    // a local metadata write failure must not fail the whole onboard — the
    // agent still starts, the UI just falls back to the generic name/orb.
    if (body.assistantName || body.avatarSeed) {
      await upsertHermesInstanceForUser(userContext.userId, {
        assistantName: body.assistantName,
        avatarSeed: body.avatarSeed,
      }).catch((error) => {
        Sentry.captureException(error, {
          tags: { context: "hermes_onboard_meta_persist" },
          extra: { userId: userContext.userId },
        });
      });
    }

    // Mirror the chosen personality Sokosumi-side (resilient on its own) so the
    // chat orb can reflect it. It's still forwarded to the orchestrator below
    // for the system prompt — this is purely the local display copy.
    if (body.personality) {
      await persistHermesPersonality(userContext.userId, body.personality);
    }

    // Push autonomy first so the orchestrator's research-intro reflects it.
    if (body.autonomyLevel) {
      await patchInstance(userContext.userId, {
        autonomyLevel: body.autonomyLevel,
      });
    }

    await startInstanceOnboarding(userContext.userId, {
      name: body.name ?? user?.name,
      email: body.email ?? user?.email,
      role: body.role,
      company: body.company,
      researchDepth: body.researchDepth,
      personality: body.personality,
    });
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to start assistant onboarding");
  }
});

app.openapi(getOnboardingProgressRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);

  try {
    const progress = await getInstanceOnboardingProgress(userContext.userId);
    return ok(c, hermesOnboardingProgressSchema.parse(progress));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to fetch onboarding progress");
  }
});

app.openapi(listIntegrationsRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);

  try {
    const integrations = await listInstanceIntegrations(userContext.userId);
    return ok(c, hermesIntegrationsListResponseSchema.parse({ integrations }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list assistant integrations");
  }
});

app.openapi(listSchedulesRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);

  try {
    const schedules = await listInstanceSchedules(userContext.userId);
    return ok(c, hermesSchedulesListResponseSchema.parse({ schedules }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list assistant schedules");
  }
});

app.openapi(patchScheduleRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { scheduleId } = c.req.valid("param");
  const body = c.req.valid("json");

  try {
    await patchSchedule(userContext.userId, scheduleId, {
      enabled: body.enabled,
    });
    // Re-fetch + return the updated row so the UI can refresh state. The
    // orchestrator currently returns 204 from PATCH; we list to find the
    // edited row.
    const schedules = await listInstanceSchedules(userContext.userId);
    const updated = schedules.find((s) => s.id === scheduleId);
    if (!updated) {
      throw serviceUnavailable(
        "Schedule updated but the row is no longer visible.",
      );
    }
    return ok(c, hermesScheduleSchema.parse(updated));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to update assistant schedule");
  }
});

app.openapi(approveConfirmationRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { confirmationId } = c.req.valid("param");
  // Body is optional on this route — when the client posts no payload Hono
  // returns `undefined` and we treat it as the no-overrides case (Hermes'
  // original args stand).
  const body = c.req.valid("json") ?? {};

  let overrides: { organizationId?: string | null } | undefined;
  // The workspace the tool call will actually run in when an override is
  // applied — captured during the membership check so the persisted audit
  // card can name it without a second lookup.
  let overrideOrganizationName: string | null = null;
  if (body.overrides) {
    overrides = {};
    if ("organizationId" in body.overrides) {
      const requestedOrgId = body.overrides.organizationId ?? null;
      if (requestedOrgId !== null) {
        // Authorization: the user must actually belong to the org they're
        // routing this confirmation into — otherwise approving with a
        // crafted id would let a member of org A create resources in
        // unrelated org B. The orchestrator trusts us, so the check has
        // to land here.
        const membership = await prisma.member.findFirst({
          where: { userId: userContext.userId, organizationId: requestedOrgId },
          select: { id: true, organization: { select: { name: true } } },
        });
        if (!membership) {
          throw badRequest(
            "You are not a member of the organization you tried to approve into.",
          );
        }
        overrideOrganizationName = membership.organization?.name ?? null;
      }
      overrides.organizationId = requestedOrgId;
    }
  }

  const pendingSnapshot = await snapshotPendingConfirmation(
    userContext.userId,
    confirmationId,
  );
  const auditConfirmation = resolveConfirmationForAudit(
    confirmationId,
    pendingSnapshot,
    body.confirmation,
  );

  try {
    const result = await approveConfirmation(
      userContext.userId,
      confirmationId,
      overrides,
    );
    // Persist a durable audit card whenever this gate leaves pending.
    // Prefer orch snapshot; fall back to a minimal id-matched card when
    // the pending list already dropped the row. `already_resolved` also
    // writes (idempotent upsert) so a race that skipped the first writer's
    // persist still leaves a trail.
    if (
      (result.status === "approved" || result.status === "already_resolved") &&
      auditConfirmation
    ) {
      const overrodeOrganization =
        result.status === "approved" &&
        overrides !== undefined &&
        "organizationId" in overrides;
      await persistHermesConfirmationCard({
        userId: userContext.userId,
        confirmation: auditConfirmation,
        status: result.status,
        organizationId: overrodeOrganization
          ? (overrides?.organizationId ?? null)
          : auditConfirmation.organizationId,
        organizationName: overrodeOrganization
          ? overrideOrganizationName
          : auditConfirmation.organizationName,
      });
    }
    return ok(c, hermesConfirmationResolveResponseSchema.parse(result));
  } catch (error) {
    return mapOrchestratorError(
      error,
      "Failed to approve assistant confirmation",
    );
  }
});

app.openapi(rejectConfirmationRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { confirmationId } = c.req.valid("param");
  const body = c.req.valid("json");

  const pendingSnapshot = await snapshotPendingConfirmation(
    userContext.userId,
    confirmationId,
  );
  const auditConfirmation = resolveConfirmationForAudit(
    confirmationId,
    pendingSnapshot,
    body.confirmation,
  );

  try {
    const result = await rejectConfirmation(
      userContext.userId,
      confirmationId,
      body.reason,
    );
    if (
      (result.status === "rejected" || result.status === "already_resolved") &&
      auditConfirmation
    ) {
      await persistHermesConfirmationCard({
        userId: userContext.userId,
        confirmation: auditConfirmation,
        status: result.status,
        organizationId: auditConfirmation.organizationId,
        organizationName: auditConfirmation.organizationName,
      });
    }
    return ok(c, hermesConfirmationResolveResponseSchema.parse(result));
  } catch (error) {
    return mapOrchestratorError(
      error,
      "Failed to reject assistant confirmation",
    );
  }
});

// NOTE: the legacy `POST /me/instance/integrations` direct-connect endpoint
// (which accepted a client-supplied mcpUrl + mcpToken and forwarded them to
// the orchestrator) has been removed — Composio managed OAuth via
// initiate → finalize is now the only path that can register an integration.
// Keeping that endpoint around let a logged-in user attach an arbitrary MCP
// URL to their account bypassing the OAuth interstitial entirely.

app.openapi(disconnectIntegrationRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { provider } = c.req.valid("param");

  // Mirror the dual-provider behaviour of finalize: Outlook's mail + calendar
  // share one Composio OAuth, so disconnecting one must disconnect both —
  // otherwise the paired half stays "connected" on the orchestrator as a
  // ghost integration.
  //
  // Use Promise.allSettled (not a sequential bail) so a failure on the
  // second delete doesn't leave the first half deleted with no attempt at
  // the other — we always at least *try* both, minimizing the orphan
  // window. If either fails we still surface the error to the client so
  // it can retry; the next attempt will be a no-op on whichever side
  // already succeeded (orchestrator returns 404 → mapped to OK in the
  // client).
  const results = await Promise.allSettled(
    pairedOrchestratorProviders(provider).map((orchestratorProvider) =>
      disconnectInstanceIntegration(userContext.userId, orchestratorProvider),
    ),
  );
  const firstFailure = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (firstFailure) {
    return mapOrchestratorError(
      firstFailure.reason,
      "Failed to disconnect assistant integration",
    );
  }
  return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
});

/**
 * The Composio toolkit `outlook` covers BOTH mail and calendar, so a single
 * OAuth (and a single disconnect) needs to register/unregister with the
 * orchestrator under both provider strings. Other providers map 1:1.
 *
 * Used by both finalize and disconnect so the pair stays consistent on the
 * orchestrator side — connecting one always connects both, disconnecting
 * one always disconnects both.
 */
function pairedOrchestratorProviders(
  provider: HermesIntegrationProvider,
): HermesIntegrationProvider[] {
  if (provider === "outlook" || provider === "outlook_calendar") {
    return ["outlook", "outlook_calendar"];
  }
  return [provider];
}

app.openapi(initiateIntegrationRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { provider, mode } = c.req.valid("json");
  const toolkit = composioToolkitForProvider(provider);
  const callbackUrl = `${getWebAppBaseUrl()}/composio/callback`;

  try {
    const authConfigId = await ensureAuthConfig(toolkit);
    // Cold-start MCP server too so finalize doesn't pay the latency.
    await ensureMcpServer(toolkit, mode, authConfigId);
    const { redirectUrl, connectionId } = await initiateConnection({
      toolkit,
      authConfigId,
      userId: userContext.userId,
      callbackUrl,
    });
    await rememberPendingConnection(connectionId, {
      userId: userContext.userId,
      provider,
      mode,
    });
    return ok(
      c,
      hermesInitiateIntegrationResponseSchema.parse({
        provider,
        redirectUrl,
        connectionId,
      }),
    );
  } catch (error) {
    return mapComposioError(error, "Failed to start integration OAuth");
  }
});

// Composio's INITIALIZING window after OAuth completion is typically
// 1-3s but spikes higher under load. The previous 8 × 750ms ≈ 6s budget
// was tight enough to time-out on busy days; bump to 40 × 1.5s ≈ 60s
// per Composio's own recommendation and give long-tail OAuths a chance.
//
// Hosted Core must allow the full poll window to finish in one invocation
// (see `functions.maxDuration` in apps/core/vercel.json). Without that
// override, Vercel's legacy 10–15s defaults can kill finalize mid-poll and
// the client sees a 504 instead of `composio_finalize_not_active`.
const FINALIZE_POLL_INTERVAL_MS = 1500;
const FINALIZE_POLL_MAX_ATTEMPTS = 40;

/**
 * Pending-connection claim written by `initiate` and consumed by
 * `finalize`. Persisted in Postgres rather than in-process memory — on
 * Vercel, initiate and finalize run on different Lambda instances and an
 * in-memory map misses on every cold-pair, surfacing as the spurious
 * "Unknown or expired connection — restart the integration flow" toast.
 *
 * The triple is captured so finalize can reject mismatches:
 *
 *   - `userId` — guards against another user finalizing this connection
 *   - `provider` / `mode` — guards against a client that initiated `read`
 *     OAuth from passing `mode: "write"` to finalize and bypassing the
 *     interstitial's read-only promise (Bugbot HIGH).
 *
 * Rows are NOT deleted on a mismatched / failed finalize — only on a
 * successful match — so:
 *   1. A guessed/leaked `connectionId` from another user can't DoS the
 *      legitimate user by erasing their pending entry on the mismatch
 *      attempt (Bugbot medium).
 *   2. Finalize can be retried after a transient "not active yet" or
 *      orchestrator hiccup without forcing a full OAuth restart
 *      (Bugbot medium).
 */
const PENDING_CONNECTION_TTL_MS = 15 * 60_000;

async function rememberPendingConnection(
  connectionId: string,
  entry: {
    userId: string;
    provider: HermesIntegrationProvider;
    mode: HermesIntegrationMode;
  },
): Promise<void> {
  const expiresAt = new Date(Date.now() + PENDING_CONNECTION_TTL_MS);
  // Upsert by connectionId: if Composio ever reuses one in a retry burst
  // we overwrite rather than throwing on the PK collision.
  await prisma.hermesPendingConnection.upsert({
    where: { connectionId },
    create: {
      connectionId,
      userId: entry.userId,
      provider: entry.provider,
      mode: entry.mode,
      expiresAt,
    },
    update: {
      userId: entry.userId,
      provider: entry.provider,
      mode: entry.mode,
      expiresAt,
    },
  });
  // Best-effort opportunistic GC. Bounded by query, not by table scan.
  await prisma.hermesPendingConnection
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((error) => {
      Sentry.captureException(error, {
        tags: { context: "hermes_pending_connection_gc" },
      });
    });
}

type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unknown" | "expired" | "user_mismatch" | "claim_mismatch";
    };

async function verifyPendingConnection(
  connectionId: string,
  claim: {
    userId: string;
    provider: HermesIntegrationProvider;
    mode: HermesIntegrationMode;
  },
): Promise<VerifyResult> {
  const entry = await prisma.hermesPendingConnection.findUnique({
    where: { connectionId },
    select: {
      userId: true,
      provider: true,
      mode: true,
      expiresAt: true,
    },
  });
  if (!entry) return { ok: false, reason: "unknown" };
  if (entry.expiresAt.getTime() < Date.now()) {
    await prisma.hermesPendingConnection
      .delete({ where: { connectionId } })
      .catch(() => {});
    return { ok: false, reason: "expired" };
  }
  if (entry.userId !== claim.userId)
    return { ok: false, reason: "user_mismatch" };
  if (entry.provider !== claim.provider || entry.mode !== claim.mode) {
    return { ok: false, reason: "claim_mismatch" };
  }
  return { ok: true };
}

async function clearPendingConnection(connectionId: string): Promise<void> {
  await prisma.hermesPendingConnection
    .delete({ where: { connectionId } })
    .catch(() => {
      // Already gone (race with another finalize, GC, etc.) — fine.
    });
}

app.openapi(finalizeIntegrationRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { provider, connectionId, mode } = c.req.valid("json");
  const toolkit = composioToolkitForProvider(provider);

  // Breadcrumb every finalize attempt — paired with the orchestrator-side
  // log added in hermes-as-service commit e76ea0c, we can now trace any
  // "unknown connection" report end-to-end.
  Sentry.addBreadcrumb({
    category: "composio_finalize",
    message: "finalize received",
    level: "info",
    data: { userId: userContext.userId, provider, mode, connectionId },
  });

  // Verify the connection matches what initiate captured for this user. We
  // explicitly check provider + mode (not just userId) so a client cannot
  // initiate "read" OAuth and then call finalize with mode: "write" to get
  // the write-scoped MCP — the interstitial showed the user a read-only
  // confirmation, finalize must honour that.
  const verify = await verifyPendingConnection(connectionId, {
    userId: userContext.userId,
    provider,
    mode,
  });
  if (!verify.ok) {
    // Distinct Sentry events per reason — `unknown` was the symptom for the
    // Vercel multi-Lambda bug; if it spikes again after the Postgres fix
    // we want to know immediately rather than discover it in user reports.
    Sentry.captureMessage(`composio_finalize_verify_failed:${verify.reason}`, {
      level: "warning",
      tags: { context: "composio_finalize", verify_reason: verify.reason },
      extra: { userId: userContext.userId, provider, mode, connectionId },
    });
    if (verify.reason === "claim_mismatch") {
      // Distinct message so callers (and logs) can tell the upgrade attempt
      // apart from a stale connectionId.
      throw badRequest(
        "Connection provider or mode does not match the initiated OAuth flow",
      );
    }
    throw badRequest(
      "Unknown or expired connection — restart the integration flow",
    );
  }

  // Poll Composio until the connection is ACTIVE. The callback page typically
  // fires immediately after the OAuth redirect lands; under load Composio
  // may sit in INITIALIZING for several seconds before flipping.
  let lastStatus: string = "INITIATED";
  let pollAttempts = 0;
  try {
    for (let attempt = 0; attempt < FINALIZE_POLL_MAX_ATTEMPTS; attempt++) {
      pollAttempts = attempt + 1;
      const { status } = await getConnection(connectionId);
      lastStatus = status;
      if (status === "ACTIVE") break;
      // FAILED / EXPIRED / INACTIVE are all terminal — bail out immediately
      // so the user gets actionable feedback instead of waiting 6s for the
      // poll budget to drain only to be told the connection won't activate.
      if (
        status === "FAILED" ||
        status === "EXPIRED" ||
        status === "INACTIVE"
      ) {
        throw badRequest(`Composio connection ${status.toLowerCase()}`);
      }
      // Skip the sleep on the final iteration — we'd just be making the
      // user wait an extra 750ms before throwing "not active yet" below.
      if (attempt < FINALIZE_POLL_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, FINALIZE_POLL_INTERVAL_MS),
        );
      }
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return mapComposioError(error, "Failed to verify integration");
  }

  if (lastStatus !== "ACTIVE") {
    Sentry.addBreadcrumb({
      category: "composio_finalize",
      message: "composio_finalize_not_active",
      level: "warning",
      data: {
        userId: userContext.userId,
        provider,
        mode,
        connectionId,
        lastStatus,
        pollAttempts,
        budgetMs: FINALIZE_POLL_MAX_ATTEMPTS * FINALIZE_POLL_INTERVAL_MS,
      },
    });
    throw badRequest(
      `Composio connection not active yet (status: ${lastStatus.toLowerCase()})`,
    );
  }
  Sentry.addBreadcrumb({
    category: "composio_finalize",
    message: "composio status active",
    level: "info",
    data: { pollAttempts, connectionId },
  });

  let mcpUrl: string;
  try {
    const authConfigId = await ensureAuthConfig(toolkit);
    const mcpServerId = await ensureMcpServer(toolkit, mode, authConfigId);
    mcpUrl = buildMcpUrl(mcpServerId, userContext.userId);
  } catch (error) {
    return mapComposioError(error, "Failed to resolve integration MCP URL");
  }

  // Register the same MCP URL under every orchestrator provider string this
  // connection covers (outlook covers both mail + calendar). We return the
  // integration row for the *requested* provider, NOT the last loop
  // iteration — otherwise an `outlook` finalize would respond with the
  // `outlook_calendar` row, and the client's optimistic UI would update
  // the wrong card.
  //
  // If a later sibling fails after an earlier one succeeded we roll back the
  // succeeded ones — otherwise an outlook pairing could end up with mail
  // connected and calendar not, leaving the documented mail+calendar pairing
  // half-broken with no way to retry cleanly.
  let requestedProviderIntegration: Awaited<
    ReturnType<typeof connectInstanceIntegration>
  > | null = null;
  let anyIntegration: Awaited<
    ReturnType<typeof connectInstanceIntegration>
  > | null = null;
  const connectedProviders: HermesIntegrationProvider[] = [];
  try {
    for (const orchestratorProvider of pairedOrchestratorProviders(provider)) {
      const integration = await connectInstanceIntegration(userContext.userId, {
        provider: orchestratorProvider,
        mcpUrl,
        mode,
      });
      connectedProviders.push(orchestratorProvider);
      anyIntegration = integration;
      if (orchestratorProvider === provider) {
        requestedProviderIntegration = integration;
      }
    }
  } catch (error) {
    for (const succeeded of connectedProviders) {
      try {
        await disconnectInstanceIntegration(userContext.userId, succeeded);
      } catch {
        // Best-effort rollback — surface the original failure to the client.
      }
    }
    return mapOrchestratorError(error, "Failed to register integration");
  }

  // Registration succeeded — release the pending entry. (Earlier failures
  // intentionally leave it in place so the client can retry without going
  // through the full OAuth round-trip again.)
  await clearPendingConnection(connectionId);

  return ok(
    c,
    hermesIntegrationSchema.parse(
      requestedProviderIntegration ??
        anyIntegration ?? {
          provider,
          status: "connecting",
          connectedAt: null,
          mode,
        },
    ),
  );
});

// ── Skills marketplace (skills.sh catalog + orchestrator install) ────────────

/** skills.sh failures are a Core↔marketplace integration concern (token,
 * upstream outage), not the user's request — surface as 503. HTTPExceptions
 * (e.g. notFound thrown by a handler) pass through untouched. */
function mapSkillsCatalogError(error: unknown, fallback: string): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof SkillsShUnavailableError) {
    throw serviceUnavailable(
      "The skills marketplace is currently unavailable.",
    );
  }
  if (isTransientFetchError(error)) {
    throw serviceUnavailable(`${fallback}.`, { reportToSentry: false });
  }
  // A real skills.sh failure (e.g. the OIDC token was rejected) — capture it so
  // we can distinguish an auth/config problem from an empty catalog.
  Sentry.captureException(error, {
    tags: { context: "hermes_skills_catalog" },
  });
  throw serviceUnavailable(`${fallback}.`);
}

/** Maps orchestrator install errors to user-facing responses. The orchestrator
 * re-validates everything, so we forward its verdict with clear copy. */
function mapSkillInstallError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof HermesOrchestratorError) {
    if (error.httpStatus === 403) {
      throw forbidden(
        "This skill is blocked for safety (audit risk too high).",
      );
    }
    if (error.httpStatus === 409) {
      throw conflict(
        "A skill with this name is already installed from a different source.",
      );
    }
    if (error.httpStatus === 404) {
      throw notFound("Hermes instance not found.");
    }
    if (error.httpStatus === 400) {
      throw badRequest(error.message || "This skill can't be installed.");
    }
    throw serviceUnavailable("Hermes is temporarily unavailable.");
  }
  throw internalServerError("Failed to install skill.");
}

/** Maps orchestrator remove errors to user-facing responses. */
function mapSkillRemoveError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof HermesOrchestratorError) {
    if (error.httpStatus === 403) {
      throw forbidden("This skill can't be removed.");
    }
    if (error.httpStatus === 404) {
      throw notFound("Skill not found.");
    }
    if (error.httpStatus === 400) {
      throw badRequest(error.message || "This skill can't be removed.");
    }
    throw serviceUnavailable("Hermes is temporarily unavailable.");
  }
  throw internalServerError("Failed to remove skill.");
}

const browseSkillsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills/catalog",
    description:
      "Browse the skills.sh leaderboard (trending/hot/all-time), ranked by popularity.",
    tags: TAGS,
    request: { query: skillsBrowseQuerySchema },
    responses: {
      200: jsonSuccessResponse(skillCatalogListSchema, "Skills catalog"),
      401: jsonErrorResponse("Unauthorized"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const searchSkillsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills/catalog/search",
    description: "Search the skills.sh catalog (2+ char query).",
    tags: TAGS,
    request: { query: skillsSearchQuerySchema },
    responses: {
      200: jsonSuccessResponse(skillCatalogListSchema, "Search results"),
      401: jsonErrorResponse("Unauthorized"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const curatedSkillsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills/catalog/curated",
    description:
      "Officially curated skills — the recommended shelf for onboarding.",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(skillCatalogListSchema, "Curated skills"),
      401: jsonErrorResponse("Unauthorized"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const skillDetailRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills/catalog/detail",
    description:
      "Skill detail + audit summary (worst risk + per-provider findings) for the install-gating dialog. File contents are fetched server-side at install time, not returned here.",
    tags: TAGS,
    request: { query: skillsDetailQuerySchema },
    responses: {
      200: jsonSuccessResponse(skillCatalogDetailSchema, "Skill detail"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const listInstalledSkillsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills",
    description:
      "Skills currently installed on the user's agent (with status).",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(installedSkillsListSchema, "Installed skills"),
      401: jsonErrorResponse("Unauthorized"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const preinstalledSkillsRoute = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/me/instance/skills/preinstalled",
    description:
      "Skills baked into the user's Hermes image (read-only; not from skills.sh). Empty until the orchestrator exposes them.",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        preinstalledSkillsListSchema,
        "Pre-installed skills",
      ),
      401: jsonErrorResponse("Unauthorized"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const installSkillRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/skills",
    description:
      "Install a skill onto the agent. Core fetches the audited files from skills.sh, blocks HIGH/CRITICAL/failed audits, and hands the rest to the orchestrator (which re-validates). Usable on the user's next message.",
    tags: TAGS,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: installSkillRequestSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(installSkillResponseSchema, "Install accepted"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Skill blocked for safety"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Slug conflict"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const removeSkillRoute = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/me/instance/skills/{slug}",
    description: "Remove an installed skill from the agent.",
    tags: TAGS,
    request: { params: z.object({ slug: z.string().min(1) }) },
    responses: {
      200: jsonSuccessResponse(hermesEmptyResponseSchema, "Skill removed"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

app.openapi(browseSkillsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  const { view, page, perPage } = c.req.valid("query");
  try {
    const skills = await browseSkills({ view, page, perPage });
    return ok(c, skillCatalogListSchema.parse({ skills }));
  } catch (error) {
    if (
      error instanceof SkillsShUnavailableError ||
      isTransientFetchError(error)
    ) {
      return ok(c, skillCatalogListSchema.parse({ skills: [] }));
    }
    return mapSkillsCatalogError(error, "Failed to load skills");
  }
});

app.openapi(searchSkillsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  const { q, limit } = c.req.valid("query");
  try {
    const skills = await searchSkills({ q, limit });
    return ok(c, skillCatalogListSchema.parse({ skills }));
  } catch (error) {
    if (
      error instanceof SkillsShUnavailableError ||
      isTransientFetchError(error)
    ) {
      return ok(c, skillCatalogListSchema.parse({ skills: [] }));
    }
    return mapSkillsCatalogError(error, "Failed to search skills");
  }
});

app.openapi(curatedSkillsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  try {
    const skills = await getCuratedSkills();
    return ok(c, skillCatalogListSchema.parse({ skills }));
  } catch (error) {
    if (
      error instanceof SkillsShUnavailableError ||
      isTransientFetchError(error)
    ) {
      return ok(c, skillCatalogListSchema.parse({ skills: [] }));
    }
    return mapSkillsCatalogError(error, "Failed to load curated skills");
  }
});

app.openapi(skillDetailRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  const { source, slug } = c.req.valid("query");
  try {
    const [detail, audit] = await Promise.all([
      getSkillDetail(source, slug),
      getSkillAudit(source, slug),
    ]);
    if (!detail) throw notFound("Skill not found.");
    return ok(
      c,
      skillCatalogDetailSchema.parse({
        skillId: detail.skillId,
        source: detail.source,
        slug: detail.slug,
        name: detail.name,
        description: detail.description,
        installs: detail.installs,
        curated: detail.curated,
        hash: detail.hash,
        installUrl: detail.installUrl,
        auditRisk: worstAuditRisk(audit),
        audits: audit.audits,
      }),
    );
  } catch (error) {
    return mapSkillsCatalogError(error, "Failed to load skill");
  }
});

app.openapi(listInstalledSkillsRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  try {
    const skills = await listInstalledSkills(userContext.userId);
    return ok(c, installedSkillsListSchema.parse({ skills }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list installed skills");
  }
});

app.openapi(preinstalledSkillsRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  try {
    const skills = await listPreinstalledSkills(userContext.userId);
    return ok(c, preinstalledSkillsListSchema.parse({ skills }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list pre-installed skills");
  }
});

app.openapi(installSkillRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { source, slug } = c.req.valid("json");

  let input: HermesInstallSkillInput;
  try {
    const [detail, audit] = await Promise.all([
      getSkillDetail(source, slug),
      getSkillAudit(source, slug),
    ]);
    if (!detail) throw notFound("Skill not found.");
    if (detail.files.length === 0) {
      throw badRequest("This skill has no installable files.");
    }
    const auditRisk = worstAuditRisk(audit);
    const hasFail = audit.audits.some((a) => a.status === "fail");
    // Hard block — the orchestrator refuses these too (403); short-circuit so
    // we never fetch-and-forward a known-unsafe skill.
    if (auditRisk === "HIGH" || auditRisk === "CRITICAL" || hasFail) {
      throw forbidden(
        "This skill is blocked for safety (audit risk too high).",
      );
    }
    input = {
      skillId: detail.skillId,
      source: detail.source,
      slug: detail.slug,
      name: detail.name,
      hash: detail.hash,
      auditRisk,
      installUrl: detail.installUrl,
      files: detail.files,
    };
  } catch (error) {
    return mapSkillsCatalogError(error, "Failed to prepare skill for install");
  }

  try {
    const result = await installSkill(userContext.userId, input);
    return ok(c, installSkillResponseSchema.parse(result));
  } catch (error) {
    return mapSkillInstallError(error);
  }
});

app.openapi(removeSkillRoute, async (c) => {
  const userContext = requireUserAuthContext(c.var.authContext);
  await requireAssistantPlanCoverage(userContext);
  const { slug } = c.req.valid("param");
  try {
    await removeInstalledSkill(userContext.userId, slug);
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  } catch (error) {
    return mapSkillRemoveError(error);
  }
});

export default app;
