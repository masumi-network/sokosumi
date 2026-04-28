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

export type PersistedChatUiPart =
  | PersistedChatUiTextPart
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

const NON_REASONING_METADATA_TYPES = new Set([
  "text",
  "file",
  "input_text",
  "output_text",
]);

function readRawMessagePartItems(message: Record<string, unknown>): unknown[] {
  const content = "content" in message ? message.content : undefined;
  const parts = "parts" in message ? message.parts : undefined;

  // Non-empty array `content` wins (explicit structured payloads).
  if (Array.isArray(content) && content.length > 0) {
    return content;
  }

  // Non-empty `parts` before string `content`: AI SDK often sends both a
  // summary string and `parts` (text + file); string-first would drop files.
  if (Array.isArray(parts) && parts.length > 0) {
    return parts;
  }

  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (Array.isArray(parts)) {
    return parts;
  }

  return [];
}

function readPersistableUiPartItems(
  message: Record<string, unknown>,
): unknown[] {
  const content = "content" in message ? message.content : undefined;
  const parts = "parts" in message ? message.parts : undefined;

  // Structured content takes precedence; avoid promoting plain string content
  // into synthetic metadata parts so legacy string responses stay unchanged.
  if (Array.isArray(content) && content.length > 0) {
    return content;
  }

  if (Array.isArray(parts) && parts.length > 0) {
    return parts;
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (Array.isArray(parts)) {
    return parts;
  }

  return [];
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

function isUrlString(value: string): boolean {
  try {
    // Use the platform URL parser so persisted metadata only stores absolute URLs.
    void new URL(value);
    return true;
  } catch {
    return false;
  }
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
      : typeof part.data === "string" && isUrlString(part.data)
        ? part.data
        : null;

  if (!rawUrl || !isUrlString(rawUrl)) {
    return null;
  }

  const filename =
    typeof part.filename === "string" && part.filename.trim().length > 0
      ? part.filename.trim()
      : undefined;

  return {
    type: "file",
    url: rawUrl,
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

  if (NON_REASONING_METADATA_TYPES.has(rawType)) {
    return null;
  }

  const type = rawType.length > 0 ? rawType : "reasoning";

  return {
    type,
    text,
  };
}

function normalizePersistedChatUiPart(
  part: unknown,
): PersistedChatUiPart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;

  return normalizeTextPart(record) ?? normalizeFilePart(record);
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
  const hasTextPart = storedUiParts.some((part) => part.type === "text");
  const text = contentText ?? "";

  const parts: PersistedConversationContentPart[] = [
    ...reasoningParts,
    ...storedUiParts,
  ];

  const trimmedFallback = fallbackPrimaryContentType?.trim();
  const shouldAddPrimaryBody =
    !hasTextPart &&
    (text.length > 0 ||
      includeEmptyTextFallback ||
      (trimmedFallback !== undefined && trimmedFallback !== ""));

  if (shouldAddPrimaryBody) {
    parts.push(syntheticPrimaryBodyPart(text, fallbackPrimaryContentType));
  }

  return parts;
}
