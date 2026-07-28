import type { UIMessage } from "ai";

export type MessageFilePart = Extract<
  UIMessage["parts"][number],
  { type: "file" }
>;

const VISIBLE_TEXT_PART_TYPES = new Set(["text", "input_text", "output_text"]);

function appendVisibleTextFromPart(part: Record<string, unknown>): string {
  if (!VISIBLE_TEXT_PART_TYPES.has(String(part.type))) {
    return "";
  }
  if ("text" in part && part.text !== null && part.text !== undefined) {
    return String(part.text);
  }
  if (
    "content" in part &&
    part.content !== null &&
    part.content !== undefined
  ) {
    return String(part.content);
  }
  return "";
}

function normalizeFilePart(part: unknown): MessageFilePart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;
  if (
    record.type !== "file" ||
    typeof record.url !== "string" ||
    typeof record.mediaType !== "string"
  ) {
    return null;
  }

  return {
    type: "file",
    url: record.url,
    mediaType: record.mediaType,
    ...(typeof record.filename === "string" && record.filename.trim()
      ? { filename: record.filename }
      : {}),
  } satisfies MessageFilePart;
}

/**
 * When both legacy array `content` and `parts` are present, the same file
 * attachment can appear twice; keep first occurrence by URL.
 */
function dedupeFilePartsByUrlInMergedParts(parts: unknown[]): unknown[] {
  const seenFileUrls = new Set<string>();
  const out: unknown[] = [];
  for (const part of parts) {
    const file = normalizeFilePart(part);
    if (file != null) {
      if (seenFileUrls.has(file.url)) {
        continue;
      }
      seenFileUrls.add(file.url);
    }
    out.push(part);
  }
  return out;
}

function readMessagePartArrays(message: Record<string, unknown>): unknown[] {
  const contentParts = Array.isArray(message.content) ? message.content : [];
  const uiParts = Array.isArray(message.parts) ? message.parts : [];
  return dedupeFilePartsByUrlInMergedParts([...contentParts, ...uiParts]);
}

function hasMeaningfulUiPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }

  const record = part as Record<string, unknown>;
  if (normalizeFilePart(record)) {
    return true;
  }

  return appendVisibleTextFromPart(record).trim().length > 0;
}

/** Visible assistant text only (text parts only; excludes reasoning, tools, etc.). */
export function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

  if (
    "content" in messageAny &&
    messageAny.content !== undefined &&
    messageAny.content !== null
  ) {
    const msgContent = messageAny.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            return appendVisibleTextFromPart(part as Record<string, unknown>);
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return appendVisibleTextFromPart(part as Record<string, unknown>);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  if (
    !content &&
    "text" in messageAny &&
    messageAny.text !== undefined &&
    messageAny.text !== null
  ) {
    content = String(messageAny.text);
  }

  return content.trim();
}

export function getMessageFileParts(message: unknown): MessageFilePart[] {
  const messageAny = message as Record<string, unknown>;
  return readMessagePartArrays(messageAny)
    .map((part) => normalizeFilePart(part))
    .filter((part): part is MessageFilePart => part !== null);
}

export function hasMessageTextOrFileParts(message: unknown): boolean {
  const messageAny = message as Record<string, unknown>;
  return readMessagePartArrays(messageAny).some((part) =>
    hasMeaningfulUiPart(part),
  );
}

/** First occurrence wins when the same id appears twice. */
export function deduplicateMessagesById<T extends { id?: string }>(
  messages: T[],
): T[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const id = m.id?.trim() ?? "";
    if (!id) {
      return true;
    }
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
