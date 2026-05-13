import * as Sentry from "@sentry/nextjs";
import { hermesMessageRepository } from "@sokosumi/database/repositories";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import {
  ensureInstanceReady,
  HermesInstanceNotReadyError,
  HermesOrchestratorError,
  HermesOrchestratorNotConfiguredError,
  proxyChatCompletions,
} from "@/lib/hermes/orchestrator-client";

interface UploadedFilePayload {
  name: string;
  type: string;
  /** "data:<mime>;base64,<payload>" */
  dataUrl: string;
}

interface ChatRequestBody {
  content?: string;
  files?: UploadedFilePayload[];
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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

const MAX_USER_CONTENT_BYTES = 32_000;
const MAX_FILES = 5;
// Aligned with the client `FileUpload` `maxSize` and the
// `serverActions.bodySizeLimit` of "20mb" in next.config.ts. Keeping the
// total cap at 20 MB too — the request body limit is the binding constraint,
// 5 × 20 MB would never reach the route.
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB raw per file
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024; // 20 MB raw across all files
const MAX_INLINED_TEXT_BYTES = 200 * 1024; // 200 KB per text file

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const ALLOWED_TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/x-sh",
  "application/x-tex",
  "application/csv",
]);

function isImageMime(type: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(type);
}

function isTextLikeMime(type: string): boolean {
  return type.startsWith("text/") || ALLOWED_TEXT_TYPES.has(type);
}

function isValidRole(role: string): role is "user" | "assistant" | "system" {
  return role === "user" || role === "assistant" || role === "system";
}

interface DecodedFile {
  name: string;
  type: string;
  bytes: Buffer;
  dataUrl: string;
}

function decodeDataUrl(
  dataUrl: string,
): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { mime: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
  } catch {
    return null;
  }
}

interface FileValidationResult {
  ok: boolean;
  files: DecodedFile[];
  error?: { code: string; detail?: string };
}

function validateAndDecodeFiles(
  raw: UploadedFilePayload[] | undefined,
): FileValidationResult {
  if (!raw || raw.length === 0) return { ok: true, files: [] };
  if (raw.length > MAX_FILES) {
    return {
      ok: false,
      files: [],
      error: { code: "too_many_files", detail: `max ${MAX_FILES}` },
    };
  }
  const decoded: DecodedFile[] = [];
  let total = 0;
  for (const f of raw) {
    if (
      typeof f.name !== "string" ||
      typeof f.type !== "string" ||
      typeof f.dataUrl !== "string"
    ) {
      return { ok: false, files: [], error: { code: "invalid_file_shape" } };
    }
    if (!isImageMime(f.type) && !isTextLikeMime(f.type)) {
      return {
        ok: false,
        files: [],
        error: { code: "unsupported_file_type", detail: f.type },
      };
    }
    const parsed = decodeDataUrl(f.dataUrl);
    if (!parsed) {
      return { ok: false, files: [], error: { code: "invalid_data_url" } };
    }
    if (parsed.bytes.length > MAX_FILE_BYTES) {
      return {
        ok: false,
        files: [],
        error: { code: "file_too_large", detail: f.name },
      };
    }
    total += parsed.bytes.length;
    if (total > MAX_TOTAL_FILE_BYTES) {
      return { ok: false, files: [], error: { code: "files_total_too_large" } };
    }
    decoded.push({
      name: f.name,
      type: f.type,
      bytes: parsed.bytes,
      dataUrl: f.dataUrl,
    });
  }
  return { ok: true, files: decoded };
}

function buildUserMessageForHermes(
  trimmed: string,
  files: DecodedFile[],
): OutboundChatMessage {
  if (files.length === 0) {
    return { role: "user", content: trimmed };
  }

  const textFiles = files.filter((f) => isTextLikeMime(f.type));
  const imageFiles = files.filter((f) => isImageMime(f.type));

  let textBody = trimmed;
  for (const f of textFiles) {
    const text = f.bytes.toString("utf8").slice(0, MAX_INLINED_TEXT_BYTES);
    const truncatedMarker =
      f.bytes.length > MAX_INLINED_TEXT_BYTES ? "\n…(truncated)" : "";
    textBody += `\n\n--- attached file: ${f.name} (${f.type}) ---\n\`\`\`\n${text}${truncatedMarker}\n\`\`\`\n--- end ${f.name} ---`;
  }

  if (imageFiles.length === 0) {
    return { role: "user", content: textBody };
  }

  const parts: ContentPart[] = [];
  parts.push({ type: "text", text: textBody });
  for (const f of imageFiles) {
    parts.push({ type: "image_url", image_url: { url: f.dataUrl } });
  }
  return { role: "user", content: parts };
}

function buildPersistedUserContent(
  trimmed: string,
  files: DecodedFile[],
): string {
  if (files.length === 0) return trimmed;
  const names = files.map((f) => f.name).join(", ");
  return trimmed ? `${trimmed}\n\n📎 ${names}` : `📎 ${names}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const userContent = typeof body.content === "string" ? body.content : "";
  const trimmed = userContent.trim();
  const fileValidation = validateAndDecodeFiles(body.files);
  if (!fileValidation.ok) {
    return NextResponse.json(
      {
        error: fileValidation.error?.code,
        detail: fileValidation.error?.detail,
      },
      { status: 400 },
    );
  }
  const files = fileValidation.files;

  if (!trimmed && files.length === 0) {
    return NextResponse.json({ error: "content_required" }, { status: 400 });
  }
  if (trimmed.length > MAX_USER_CONTENT_BYTES) {
    return NextResponse.json({ error: "content_too_large" }, { status: 413 });
  }

  const userId = session.user.id;

  // Build conversation from DB history + new user turn. Historical messages
  // are stored as strings (annotated for file references) — they're fine to
  // send as-is. The current turn may be multimodal.
  const history = await hermesMessageRepository.listForUser(userId, prisma);
  const conversation: OutboundChatMessage[] = [
    ...history
      .filter((m) => isValidRole(m.role))
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
      })),
    buildUserMessageForHermes(trimmed, files),
  ];

  // v3 spec: chat goes through the orchestrator's proxy. We never call the
  // sprite URL directly anymore — that bypasses billing, spend caps, and
  // admin visibility (and will be blocked in a future release).
  try {
    await ensureInstanceReady(userId);
  } catch (error) {
    if (error instanceof HermesInstanceNotReadyError) {
      return NextResponse.json(
        { error: "instance_not_ready", status: error.status },
        { status: 409 },
      );
    }
    if (error instanceof HermesOrchestratorNotConfiguredError) {
      return NextResponse.json(
        { error: "orchestrator_not_configured" },
        { status: 503 },
      );
    }
    if (error instanceof HermesOrchestratorError) {
      return NextResponse.json(
        { error: "orchestrator_error", code: error.code },
        { status: 502 },
      );
    }
    Sentry.captureException(error, { tags: { context: "hermes_chat_ready" } });
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }

  const upstream = await proxyChatCompletions(userId, {
    model: "hermes-agent",
    messages: conversation,
    stream: false,
  });

  if (upstream.status >= 500) {
    Sentry.captureMessage("hermes_proxy_5xx", {
      level: "warning",
      tags: { status: String(upstream.status) },
    });
    return NextResponse.json(
      { error: "hermes_endpoint_error", status: upstream.status },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: "hermes_endpoint_error", status: upstream.status, detail: text },
      { status: upstream.status },
    );
  }

  let parsed: OpenAIChatResponse;
  try {
    parsed = (await upstream.json()) as OpenAIChatResponse;
  } catch {
    return NextResponse.json(
      { error: "hermes_endpoint_invalid_response" },
      { status: 502 },
    );
  }

  const reply = parsed.choices?.[0]?.message;
  const content = typeof reply?.content === "string" ? reply.content : "";
  if (!content) {
    return NextResponse.json(
      { error: "hermes_endpoint_empty_response" },
      { status: 502 },
    );
  }

  // Persist user message as plain text with filename annotations. We don't
  // store base64 image bytes or huge text dumps in the DB — history is meant
  // for display + Hermes context, not as a file vault.
  const persistedUserContent = buildPersistedUserContent(trimmed, files);

  try {
    await prisma.$transaction(async (tx) =>
      hermesMessageRepository.appendPair(
        {
          userId,
          userContent: persistedUserContent,
          assistantContent: content,
        },
        tx,
      ),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_chat_persist" },
    });
  }

  return NextResponse.json({
    message: { role: "assistant" as const, content },
  });
}
