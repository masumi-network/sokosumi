import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";

import { isSafeRemoteUrl, normalizeSafeRemoteUrl } from "@/helpers/safe-url";

export interface PersistedChatUiReasoningPart {
  type: string;
  text: string;
}

export interface PersistedChatUiTextPart {
  type: "text";
  text: string;
}

export interface PersistedChatUiFilePart {
  type: "file";
  url: string;
  mediaType: string;
  filename?: string;
}

/** Assistant / Responses-style body text; preserved in `ui_message_v1` for API round-trip. */
export interface PersistedChatUiOutputTextPart {
  type: "output_text";
  text: string;
}

export type PersistedChatUiPart =
  | PersistedChatUiTextPart
  | PersistedChatUiOutputTextPart
  | PersistedChatUiFilePart;

/** Primary assistant body may echo persisted `contentType` (e.g. `output_text`). */
export interface PersistedConversationPrimaryBodyPart {
  type: string;
  text: string;
}

export type PersistedConversationContentPart =
  | PersistedChatUiReasoningPart
  | PersistedChatUiPart
  | PersistedConversationPrimaryBodyPart;

interface ConversationMessageMetadataShape {
  reasoning?: unknown;
  ui_message_v1?: {
    parts?: unknown;
  };
}

const TEXT_LIKE_PART_TYPES = new Set(["text", "input_text", "output_text"]);

function messageHasTextLikePart(items: unknown[]): boolean {
  for (const part of items) {
    if (!part || typeof part !== "object") {
      continue;
    }

    if (normalizeTextPart(part as Record<string, unknown>)) {
      return true;
    }
  }

  return false;
}

/**
 * When structured `content` / `parts` win precedence but carry no
 * text-like segments (e.g. file-only `parts`), keep parallel string `content`
 * as a leading synthetic text part so prompts are not dropped.
 */
function mergeStringContentWhenNoTextLikeParts(
  items: unknown[],
  content: unknown,
): unknown[] {
  if (
    items.length === 0 ||
    typeof content !== "string" ||
    content.trim().length === 0 ||
    messageHasTextLikePart(items)
  ) {
    return items;
  }

  return [{ type: "text", text: content }, ...items];
}

/**
 * Shared precedence for reading `content` / `parts` from AI SDK–shaped
 * messages. Non-empty structured arrays win; non-empty `parts` beats string
 * `content` so file parts are not dropped. Empty arrays are fallbacks.
 *
 * String `content` is merged ahead of structured items when those items omit
 * any text-like part (attachment-only arrays).
 *
 * @param stringContent - `"synthetic-text-part"` wraps string `content` for
 *   downstream normalization (e.g. `extractMessageText`). `"omit"` skips
 *   string promotion so persistable UI metadata does not mirror plain strings.
 */
function readMessagePartItems(
  message: Record<string, unknown>,
  stringContent: "synthetic-text-part" | "omit",
): unknown[] {
  const content = "content" in message ? message.content : undefined;
  const parts = "parts" in message ? message.parts : undefined;

  if (Array.isArray(content) && content.length > 0) {
    // `mergeStringContentWhenNoTextLikeParts` only prepends when the second arg is
    // a non-empty string; passing the same array as both args was always a no-op.
    return content;
  }

  if (Array.isArray(parts) && parts.length > 0) {
    return mergeStringContentWhenNoTextLikeParts(parts, content);
  }

  if (stringContent === "synthetic-text-part" && typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (Array.isArray(parts)) {
    return mergeStringContentWhenNoTextLikeParts(parts, content);
  }

  return [];
}

function readRawMessagePartItems(message: Record<string, unknown>): unknown[] {
  return readMessagePartItems(message, "synthetic-text-part");
}

function readPersistableUiPartItems(
  message: Record<string, unknown>,
): unknown[] {
  return readMessagePartItems(message, "omit");
}

function normalizeTextPart(
  part: Record<string, unknown>,
): PersistedChatUiTextPart | null {
  if (
    typeof part.text !== "string" ||
    !TEXT_LIKE_PART_TYPES.has(String(part.type))
  ) {
    return null;
  }

  return {
    type: "text",
    text: part.text,
  };
}

function normalizeFilePart(
  part: Record<string, unknown>,
): PersistedChatUiFilePart | null {
  if (part.type !== "file" || typeof part.mediaType !== "string") {
    return null;
  }

  const rawUrl =
    typeof part.url === "string"
      ? part.url
      : typeof part.data === "string" && isSafeRemoteUrl(part.data)
        ? part.data
        : null;

  if (!rawUrl) {
    return null;
  }

  const normalizedUrl = normalizeSafeRemoteUrl(rawUrl);
  if (!normalizedUrl) {
    return null;
  }

  const filename =
    typeof part.filename === "string" && part.filename.trim().length > 0
      ? part.filename.trim()
      : undefined;

  return {
    type: "file",
    url: normalizedUrl,
    mediaType: part.mediaType,
    ...(filename ? { filename } : {}),
  };
}

function normalizeReasoningPart(
  part: Record<string, unknown>,
): PersistedChatUiReasoningPart | null {
  if (typeof part.text !== "string") {
    return null;
  }

  const text = part.text.trim();
  if (text.length === 0) {
    return null;
  }

  const rawType =
    "type" in part && typeof part.type === "string" ? part.type.trim() : "";
  // Missing type defaults to standard reasoning; unknown labels are not Thought.
  const type = rawType.length > 0 ? rawType : "reasoning";
  if (!isChatUiProviderReasoningPartType(type)) {
    return null;
  }

  return {
    type,
    text,
  };
}

function normalizePersistedOutputTextPart(
  record: Record<string, unknown>,
): PersistedChatUiOutputTextPart | null {
  if (record.type !== "output_text" || typeof record.text !== "string") {
    return null;
  }

  return { type: "output_text", text: record.text };
}

function normalizePersistedChatUiPart(
  part: unknown,
): PersistedChatUiPart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;

  return (
    normalizePersistedOutputTextPart(record) ??
    normalizeTextPart(record) ??
    normalizeFilePart(record)
  );
}

function normalizeConversationContentPart(
  part: unknown,
): PersistedConversationContentPart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;

  return (
    normalizeReasoningPart(record) ??
    normalizePersistedOutputTextPart(record) ??
    normalizeTextPart(record) ??
    normalizeFilePart(record)
  );
}

function syntheticPrimaryBodyPart(
  text: string,
  fallbackPrimaryContentType: string | null | undefined,
): PersistedConversationContentPart {
  const raw = fallbackPrimaryContentType?.trim();
  if (!raw || raw === "file" || raw === "text") {
    return { type: "text", text };
  }

  return { type: raw, text };
}

export function extractMessageText(message: Record<string, unknown>): string {
  return readRawMessagePartItems(message)
    .map((part): string => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const textPart = normalizeTextPart(part as Record<string, unknown>);
      return textPart?.text ?? "";
    })
    .filter(Boolean)
    .join("");
}

export function extractPersistableUiParts(
  message: Record<string, unknown>,
): PersistedChatUiPart[] {
  return readPersistableUiPartItems(message)
    .map((part) => normalizePersistedChatUiPart(part))
    .filter((part): part is PersistedChatUiPart => part !== null);
}

export function hasModelVisibleMessageContent(
  message: Record<string, unknown>,
): boolean {
  if (extractMessageText(message).trim().length > 0) {
    return true;
  }

  return extractPersistableUiParts(message).some((part) => {
    if (part.type === "file") {
      return true;
    }

    return part.text.trim().length > 0;
  });
}

function buildTitleSourceFromFilePart(part: PersistedChatUiFilePart): string {
  const filename = part.filename?.trim();
  if (filename) {
    return filename;
  }

  if (part.mediaType.toLowerCase().startsWith("image/")) {
    return "Image message";
  }

  try {
    const url = new URL(part.url);
    const lastPathSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastPathSegment && lastPathSegment.length > 0
      ? lastPathSegment
      : url.hostname;
  } catch {
    return "File message";
  }
}

export function buildMessageTitleSource(
  message: Record<string, unknown>,
): string | null {
  const extractedText = extractMessageText(message).trim();
  if (extractedText.length > 0) {
    return extractedText;
  }

  for (const uiPart of extractPersistableUiParts(message)) {
    if (uiPart.type === "file") {
      return buildTitleSourceFromFilePart(uiPart);
    }

    const partText = uiPart.text.trim();
    if (partText.length > 0) {
      return partText;
    }
  }

  return null;
}

/** Reasoning segments from structured `content` / `parts` (for persisting `metadata.reasoning`). */
export function extractReasoningPartsFromMessage(
  message: Record<string, unknown>,
): PersistedChatUiReasoningPart[] {
  return readRawMessagePartItems(message)
    .map((part) =>
      part && typeof part === "object"
        ? normalizeReasoningPart(part as Record<string, unknown>)
        : null,
    )
    .filter((part): part is PersistedChatUiReasoningPart => part !== null);
}

export function extractUiMessageParts(
  message: Record<string, unknown>,
): PersistedConversationContentPart[] {
  return readRawMessagePartItems(message)
    .map((part) => normalizeConversationContentPart(part))
    .filter((part): part is PersistedConversationContentPart => part !== null);
}

export function readPersistedUiPartsFromMetadata(
  metadata: unknown,
): PersistedChatUiPart[] {
  const meta = metadata as ConversationMessageMetadataShape | null;
  const rawParts = meta?.ui_message_v1?.parts;
  if (!Array.isArray(rawParts)) {
    return [];
  }

  return rawParts
    .map((part) => normalizePersistedChatUiPart(part))
    .filter((part): part is PersistedChatUiPart => part !== null);
}

export function readReasoningPartsFromMetadata(
  metadata: unknown,
): PersistedChatUiReasoningPart[] {
  const meta = metadata as ConversationMessageMetadataShape | null;
  const rawReasoning = meta?.reasoning;
  if (!Array.isArray(rawReasoning)) {
    return [];
  }

  return rawReasoning
    .map((part) =>
      part && typeof part === "object"
        ? normalizeReasoningPart(part as Record<string, unknown>)
        : null,
    )
    .filter((part): part is PersistedChatUiReasoningPart => part !== null);
}

export function buildConversationContentParts(params: {
  contentText: string | null | undefined;
  metadata: unknown;
  includeEmptyTextFallback?: boolean;
  /** When set (e.g. DB `contentType`), echoed for the synthesized body part instead of `text`. */
  fallbackPrimaryContentType?: string | null;
  reasoningParts?: PersistedChatUiReasoningPart[];
  storedUiParts?: PersistedChatUiPart[];
}): PersistedConversationContentPart[] {
  const {
    contentText,
    metadata,
    includeEmptyTextFallback = false,
    fallbackPrimaryContentType,
    reasoningParts: providedReasoningParts,
    storedUiParts: providedStoredUiParts,
  } = params;

  const reasoningParts =
    providedReasoningParts ?? readReasoningPartsFromMetadata(metadata);
  const storedUiParts =
    providedStoredUiParts ?? readPersistedUiPartsFromMetadata(metadata);
  const hasTextPart = storedUiParts.some(
    (part) => part.type === "text" || part.type === "output_text",
  );
  const text = contentText ?? "";

  const parts: PersistedConversationContentPart[] = [
    ...reasoningParts,
    ...storedUiParts,
  ];

  const trimmedFallback = fallbackPrimaryContentType?.trim();
  const hasFilePart = storedUiParts.some((part) => part.type === "file");
  /** Empty synthetic `{ type: "text", text: "" }` is redundant when files already carry the body. */
  const wouldAddRedundantEmptyTextAfterFiles =
    text.length === 0 &&
    hasFilePart &&
    (!trimmedFallback ||
      trimmedFallback === "file" ||
      trimmedFallback === "text" ||
      trimmedFallback === "output_text");

  const shouldAddPrimaryBody =
    !hasTextPart &&
    !wouldAddRedundantEmptyTextAfterFiles &&
    (text.length > 0 ||
      includeEmptyTextFallback ||
      (trimmedFallback !== undefined && trimmedFallback !== ""));

  if (shouldAddPrimaryBody) {
    parts.push(syntheticPrimaryBodyPart(text, fallbackPrimaryContentType));
  }

  return parts;
}
