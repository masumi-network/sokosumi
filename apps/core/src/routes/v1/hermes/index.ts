import { Buffer } from "node:buffer";
import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  isUserUploadAllowedContentType,
  normalizeUserUploadContentType,
  resolveUserUploadContentType,
  USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET,
} from "@sokosumi/utils";
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
  HermesInstanceNotReadyError,
  type HermesIntegrationProvider,
  HermesOrchestratorError,
  isReservedSecretKey,
  isValidSecretKey,
  listInstanceIntegrations,
  listInstanceSchedules,
  patchInstance,
  patchSchedule,
  provisionInstance,
  proxyChatCompletions,
  rejectConfirmation,
  setInstanceSecret,
  startInstanceOnboarding,
} from "@/clients/hermes-orchestrator.client";
import {
  getWebAppBaseUrl,
  resolveSokosumiEnvForOrchestrator,
} from "@/config/env";
import {
  badRequest,
  internalServerError,
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
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { conflictWithData, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth, withGlobalHeaderParameters } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  hermesChatRequestSchema,
  hermesChatResponseSchema,
  hermesConfirmationResolveResponseSchema,
  hermesConnectIntegrationRequestSchema,
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

function sniffImageMimeFromBytes(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }

  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
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

function mapOrchestratorError(error: unknown, fallback: string): never {
  if (error instanceof HTTPException) {
    throw error;
  }

  if (error instanceof HermesOrchestratorError) {
    if (error.httpStatus >= 500) {
      throw serviceUnavailable(`${fallback}: ${error.message}`);
    }

    // Auth / permission / rate-limit responses from the orchestrator reflect Core's
    // integration (token, quotas), not the end user's request — avoid 400.
    if (
      error.httpStatus === 401 ||
      error.httpStatus === 403 ||
      error.httpStatus === 429
    ) {
      throw serviceUnavailable("Hermes is temporarily unavailable.");
    }

    throw badRequest(error.message);
  }

  throw internalServerError(fallback);
}

async function upsertHermesInstanceForUser(userId: string): Promise<void> {
  await prisma.hermesInstance.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * Stable namespace UUID for deriving HermesMessage ids from welcome-event
 * tuples. Bound to this codebase; do NOT change without a migration plan
 * (it shifts every existing welcome's deterministic id).
 */
const HERMES_WELCOME_UUID_NAMESPACE = "f4e5b2cd-1c1a-4d8a-9a2e-7c1ad1b8d5a9";

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
  const createdAt = new Date(args.onboardedAtIso);
  if (Number.isNaN(createdAt.getTime())) return;

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

const postChatRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/chat",
    description: "Send a message to the current user's Hermes instance",
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
        "Hermes chat response. The assistant message is returned as data.message.",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonSuccessResponse(
        hermesInstanceNotReadySchema,
        "Hermes instance is not ready. Uses the standard data/meta envelope with only data.status.",
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
    description: "Get the current user's Hermes instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesGetInstanceEnvelopeSchema,
        "Hermes instance (data.instance is null when none exists)",
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
    description: "Provision the current user's Hermes instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(hermesInstanceSchema, "Hermes instance"),
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
      "Update mutable fields (autonomyLevel, name, email) on the current user's Hermes instance",
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
      200: jsonSuccessResponse(hermesInstanceSchema, "Updated Hermes instance"),
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
    description: "Destroy the current user's Hermes instance",
    tags: TAGS,
    responses: {
      200: jsonSuccessResponse(
        hermesEmptyResponseSchema,
        "Hermes instance destroyed",
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
    description: "List the current user's persisted Hermes messages",
    tags: TAGS,
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(hermesPersistedMessageSchema),
        "Hermes messages",
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
    description: "Get the current user's unread Hermes inbox count",
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
    description: "Mark current user's Hermes inbox messages as seen",
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
        "Hermes inbox marked seen",
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
    description: "Set a secret on the current user's Hermes instance",
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
      200: jsonSuccessResponse(hermesEmptyResponseSchema, "Hermes secret set"),
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
    description: "List the current user's connected Hermes integrations",
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
      "Approve a medium-autonomy pending tool call. The orchestrator runs it and returns the result.",
    tags: TAGS,
    request: {
      params: z.object({
        confirmationId: z.string().min(1),
      }),
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

const connectIntegrationRoute = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/me/instance/integrations",
    description:
      "Connect a third-party provider via its Composio MCP URL + token",
    tags: TAGS,
    request: {
      body: {
        content: {
          "application/json": {
            schema: hermesConnectIntegrationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        hermesIntegrationSchema,
        "Integration connecting",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
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

// Temporary beta posture: web navigation/page access is domain-gated, while the
// Core API remains available to authenticated users during early Hermes rollout.
app.openapi(postChatRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
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

  const historyNewestFirst = await prisma.hermesMessage.findMany({
    where: { userId: userContext.userId },
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
    throw serviceUnavailable("Hermes is temporarily unavailable.");
  }

  if (upstream.status >= 500) {
    Sentry.captureMessage("hermes_proxy_5xx", {
      level: "warning",
      tags: { status: String(upstream.status) },
    });
    throw serviceUnavailable("Hermes is temporarily unavailable.");
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    throw badRequest(text || "Hermes rejected the chat request.");
  }

  const parsed = (await upstream
    .json()
    .catch(() => null)) as OpenAIChatResponse | null;
  const content =
    typeof parsed?.choices?.[0]?.message?.content === "string"
      ? parsed.choices[0].message.content
      : "";

  if (!content) {
    throw serviceUnavailable("Hermes returned an empty response.");
  }

  const persistedUserContent = buildPersistedUserContent(trimmed, files);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.hermesMessage.create({
        data: {
          userId: userContext.userId,
          role: "user",
          content: persistedUserContent,
        },
      });
      await tx.hermesMessage.create({
        data: {
          userId: userContext.userId,
          role: "assistant",
          content,
        },
      });
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_chat_persist" },
    });
  }

  return ok(
    c,
    hermesChatResponseSchema.parse({
      message: { role: "assistant", content },
    }),
  );
});

app.openapi(getInstanceRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);

  try {
    const instance = await getInstance(userContext.userId);
    if (instance) {
      await upsertHermesInstanceForUser(userContext.userId).catch((error) => {
        Sentry.captureException(error, {
          tags: { context: "hermes_instance_backfill" },
        });
      });

      // Atomic welcome (orchestrator's "ready" payload carries the intro).
      // Persist it on first sight so the chat opens with the welcome
      // already rendered via the existing message-fetch path — no separate
      // poll-and-drain race. Awaited deliberately: the client typically
      // fetches messages immediately after seeing `status === "ready"`,
      // so persisting in the background would let the first fetch return
      // an empty inbox and flash empty chat.
      if (instance.welcomeMessage && instance.onboardedAt) {
        try {
          await persistHermesWelcomeMessage({
            userId: userContext.userId,
            content: instance.welcomeMessage,
            kind: instance.welcomeKind,
            onboardedAtIso: instance.onboardedAt,
          });
        } catch (error) {
          Sentry.captureException(error, {
            tags: { context: "hermes_welcome_persist" },
          });
        }
      }
    }

    return ok(
      c,
      instance
        ? hermesGetInstanceEnvelopeSchema.parse({
            hasInstance: true,
            instance: hermesInstanceSchema.parse(instance),
          })
        : hermesGetInstanceEnvelopeSchema.parse({ hasInstance: false }),
    );
  } catch (error) {
    return mapOrchestratorError(error, "Failed to fetch Hermes instance");
  }
});

app.openapi(provisionInstanceRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const user = await prisma.user.findUnique({
    where: { id: userContext.userId },
    select: { name: true, email: true },
  });

  try {
    await provisionInstance(userContext.userId, {
      name: user?.name,
      email: user?.email,
      sokosumiEnv: resolveSokosumiEnvForOrchestrator(),
    });
    const instance = await getInstance(userContext.userId);

    if (!instance) {
      throw serviceUnavailable(
        "Provision call succeeded but the Hermes instance is not visible yet.",
      );
    }

    await upsertHermesInstanceForUser(userContext.userId).catch((error) => {
      Sentry.captureException(error, {
        tags: { context: "hermes_instance_upsert" },
      });
    });

    return ok(c, hermesInstanceSchema.parse(instance));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to provision Hermes instance");
  }
});

app.openapi(updateInstanceRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const body = c.req.valid("json");

  try {
    await patchInstance(userContext.userId, {
      autonomyLevel: body.autonomyLevel,
      name: body.name,
      email: body.email,
      timezone: body.timezone,
    });
    const instance = await getInstance(userContext.userId);

    if (!instance) {
      throw serviceUnavailable(
        "Update succeeded but the Hermes instance is no longer visible.",
      );
    }

    return ok(c, hermesInstanceSchema.parse(instance));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to update Hermes instance");
  }
});

app.openapi(destroyInstanceRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);

  try {
    await destroyInstance(userContext.userId);
  } catch (error) {
    return mapOrchestratorError(error, "Failed to destroy Hermes instance");
  }

  try {
    await prisma.$transaction([
      prisma.hermesMessage.deleteMany({
        where: { userId: userContext.userId },
      }),
      prisma.hermesInstance.deleteMany({
        where: { userId: userContext.userId },
      }),
    ]);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_destroy_db_cleanup" },
      extra: { userId: userContext.userId },
    });
    throw serviceUnavailable(
      "Your Hermes instance was removed, but we could not clear related data in our system. Please try again shortly; repeating this action is safe.",
    );
  }

  return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
});

app.openapi(listMessagesRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
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
  const userContext = requireUserContext(c.var.authContext);
  const instance = await prisma.hermesInstance.findUnique({
    where: { userId: userContext.userId },
    select: { lastSeenInboxAt: true },
  });

  if (!instance) {
    return ok(c, hermesUnreadCountSchema.parse({ count: 0 }));
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

  return ok(c, hermesUnreadCountSchema.parse({ count }));
});

app.openapi(markInboxSeenRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const body = c.req.valid("json");
  const target = body.asOfIso ? new Date(body.asOfIso) : new Date();

  if (Number.isNaN(target.getTime())) {
    throw unprocessableEntity("asOfIso must be a valid ISO datetime.");
  }

  const instance = await prisma.hermesInstance.findUnique({
    where: { userId: userContext.userId },
    select: { lastSeenInboxAt: true },
  });

  if (
    !instance ||
    (instance.lastSeenInboxAt && instance.lastSeenInboxAt >= target)
  ) {
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  }

  await prisma.hermesInstance.update({
    where: { userId: userContext.userId },
    data: { lastSeenInboxAt: target },
  });

  return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
});

app.openapi(setSecretRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
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
    return mapOrchestratorError(error, "Failed to write Hermes secret");
  }
});

// ─── Onboarding v2 handlers ───────────────────────────────────────────────

app.openapi(startOnboardingRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const body = c.req.valid("json");

  // Pull name/email from the DB if the client didn't provide them, so the
  // orchestrator's research pass has the best chance of finding context.
  const user = await prisma.user.findUnique({
    where: { id: userContext.userId },
    select: { name: true, email: true },
  });

  try {
    // Push autonomy first so the orchestrator's research-intro reflects it.
    if (body.autonomyLevel) {
      await patchInstance(userContext.userId, {
        autonomyLevel: body.autonomyLevel,
      });
    }

    await startInstanceOnboarding(userContext.userId, {
      name: body.name ?? user?.name,
      email: body.email ?? user?.email,
      researchDepth: body.researchDepth,
    });
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to start Hermes onboarding");
  }
});

app.openapi(getOnboardingProgressRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);

  try {
    const progress = await getInstanceOnboardingProgress(userContext.userId);
    return ok(c, hermesOnboardingProgressSchema.parse(progress));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to fetch onboarding progress");
  }
});

app.openapi(listIntegrationsRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);

  try {
    const integrations = await listInstanceIntegrations(userContext.userId);
    return ok(c, hermesIntegrationsListResponseSchema.parse({ integrations }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list Hermes integrations");
  }
});

app.openapi(listSchedulesRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);

  try {
    const schedules = await listInstanceSchedules(userContext.userId);
    return ok(c, hermesSchedulesListResponseSchema.parse({ schedules }));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to list Hermes schedules");
  }
});

app.openapi(patchScheduleRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
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
    return mapOrchestratorError(error, "Failed to update Hermes schedule");
  }
});

app.openapi(approveConfirmationRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const { confirmationId } = c.req.valid("param");

  try {
    const result = await approveConfirmation(
      userContext.userId,
      confirmationId,
    );
    return ok(c, hermesConfirmationResolveResponseSchema.parse(result));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to approve Hermes confirmation");
  }
});

app.openapi(rejectConfirmationRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const { confirmationId } = c.req.valid("param");
  const body = c.req.valid("json");

  try {
    const result = await rejectConfirmation(
      userContext.userId,
      confirmationId,
      body.reason,
    );
    return ok(c, hermesConfirmationResolveResponseSchema.parse(result));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to reject Hermes confirmation");
  }
});

app.openapi(connectIntegrationRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const body = c.req.valid("json");

  try {
    const integration = await connectInstanceIntegration(userContext.userId, {
      provider: body.provider,
      mcpUrl: body.mcpUrl,
      mcpToken: body.mcpToken,
      mode: body.mode,
    });
    return ok(c, hermesIntegrationSchema.parse(integration));
  } catch (error) {
    return mapOrchestratorError(error, "Failed to connect Hermes integration");
  }
});

app.openapi(disconnectIntegrationRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const { provider } = c.req.valid("param");

  // Mirror the dual-provider behaviour of finalize: Outlook's mail + calendar
  // share one Composio OAuth, so disconnecting one must disconnect both —
  // otherwise the paired half stays "connected" on the orchestrator as a
  // ghost integration.
  try {
    for (const orchestratorProvider of pairedOrchestratorProviders(provider)) {
      await disconnectInstanceIntegration(
        userContext.userId,
        orchestratorProvider,
      );
    }
    return ok(c, hermesEmptyResponseSchema.parse({ ok: true }));
  } catch (error) {
    return mapOrchestratorError(
      error,
      "Failed to disconnect Hermes integration",
    );
  }
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
  const userContext = requireUserContext(c.var.authContext);
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
    rememberPendingConnection(connectionId, userContext.userId);
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

const FINALIZE_POLL_INTERVAL_MS = 750;
const FINALIZE_POLL_MAX_ATTEMPTS = 8;

/**
 * Short-lived map of `connectionId -> { userId, expiresAt }` populated by
 * initiate and consumed by finalize. Lets finalize reject any client-supplied
 * `connectionId` that wasn't created by this server for the same authenticated
 * user — without this, a leaked connectionId could be passed to a different
 * user's finalize and register a non-functional MCP under their account.
 *
 * In-memory is fine: the OAuth round-trip is ~seconds, well under the TTL,
 * and a server restart between initiate and finalize is rare enough that
 * forcing a retry is the right failure mode.
 */
const PENDING_CONNECTION_TTL_MS = 15 * 60_000;
const pendingConnections = new Map<
  string,
  { userId: string; expiresAt: number }
>();

function rememberPendingConnection(connectionId: string, userId: string): void {
  pendingConnections.set(connectionId, {
    userId,
    expiresAt: Date.now() + PENDING_CONNECTION_TTL_MS,
  });
  // Opportunistic GC on write so the map can't grow unbounded.
  if (pendingConnections.size > 256) {
    const now = Date.now();
    for (const [key, entry] of pendingConnections) {
      if (entry.expiresAt < now) pendingConnections.delete(key);
    }
  }
}

function consumePendingConnection(
  connectionId: string,
  userId: string,
): boolean {
  const entry = pendingConnections.get(connectionId);
  if (!entry) return false;
  pendingConnections.delete(connectionId);
  if (entry.expiresAt < Date.now()) return false;
  return entry.userId === userId;
}

app.openapi(finalizeIntegrationRoute, async (c) => {
  const userContext = requireUserContext(c.var.authContext);
  const { provider, connectionId, mode } = c.req.valid("json");
  const toolkit = composioToolkitForProvider(provider);

  // Verify the connection was created by THIS server for THIS user. Without
  // this, a leaked or guessed `connectionId` from another user's OAuth could
  // be finalized under the attacker's account.
  if (!consumePendingConnection(connectionId, userContext.userId)) {
    throw badRequest(
      "Unknown or expired connection — restart the integration flow",
    );
  }

  // Poll Composio until the connection is ACTIVE. The callback page typically
  // fires immediately after the OAuth redirect lands, so a handful of short
  // polls is enough.
  let lastStatus: string = "INITIATED";
  try {
    for (let attempt = 0; attempt < FINALIZE_POLL_MAX_ATTEMPTS; attempt++) {
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
    throw badRequest(
      `Composio connection not active yet (status: ${lastStatus.toLowerCase()})`,
    );
  }

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

export default app;
