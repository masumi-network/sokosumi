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
import {
  destroyInstance,
  ensureInstanceReady,
  getInstance,
  HermesInstanceNotReadyError,
  HermesOrchestratorError,
  isReservedSecretKey,
  isValidSecretKey,
  provisionInstance,
  proxyChatCompletions,
  setInstanceSecret,
} from "@/clients/hermes-orchestrator.client";
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
  hermesEmptyResponseSchema,
  hermesGetInstanceEnvelopeSchema,
  hermesInstanceNotReadySchema,
  hermesInstanceSchema,
  hermesPersistedMessageSchema,
  hermesUnreadCountSchema,
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

export default app;
