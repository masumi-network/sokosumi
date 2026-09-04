import {
  removeTaskContextAttachmentLinks,
  replaceMarkdownLinks,
} from "@sokosumi/utils";

import { openrouterClient } from "@/clients/openrouter.client";

const TASK_AUTO_NAME_MAX_LENGTH = 60;
const UNTITLED_TASK_NAME = "Untitled Task";
const HTML_TAG_REGEX = /<[^>]*>/g;
const CODE_FENCE_BLOCK_REGEX = /(`{3,}|~{3,})[\s\S]*?\1/g;
const FENCE_LINE_REGEX = /^\s*(`{3,}|~{3,})/;
const HEADING_MARKER_REGEX = /^#{1,6}\s+/gm;
const BLOCKQUOTE_PREFIX_REGEX = /^>\s?/gm;
const INLINE_CODE_REGEX = /`([^`]+)`/g;
const WRAPPING_QUOTES_REGEX = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;
const TRAILING_PERIODS_REGEX = /\.+$/u;
const REFUSAL_REGEX = /\b(?:i cannot|unable to|i need to be transparent)\b/i;
const DUMP_REGEX = /^\s*#|##|```|[\n\r]|(?:^|\s)\d+\.\s.+\s\d+\.\s/;

function stripHtmlTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(HTML_TAG_REGEX, "");
  } while (current !== previous);
  return current;
}

function unwrapEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^_(.+)_$/s, "$1");
}

function cleanAutoName(text: string): string {
  const cleaned = unwrapEmphasis(
    stripHtmlTags(replaceMarkdownLinks(text, (link) => link.text))
      .replace(CODE_FENCE_BLOCK_REGEX, " ")
      .replace(HEADING_MARKER_REGEX, "")
      .replace(BLOCKQUOTE_PREFIX_REGEX, "")
      .replace(INLINE_CODE_REGEX, "$1"),
  )
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(WRAPPING_QUOTES_REGEX, "")
    .trim()
    .replace(TRAILING_PERIODS_REGEX, "")
    .trim();

  return [...cleaned].slice(0, TASK_AUTO_NAME_MAX_LENGTH).join("").trim();
}

function isRejectedGeneratedName(raw: string, cleaned: string): boolean {
  if (!cleaned) {
    return true;
  }
  if (REFUSAL_REGEX.test(raw) || REFUSAL_REGEX.test(cleaned)) {
    return true;
  }
  return DUMP_REGEX.test(raw);
}

function fallbackTaskName(source: string): string {
  let inFence = false;
  for (const line of source.split("\n")) {
    if (FENCE_LINE_REGEX.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.trim()) {
      continue;
    }
    const cleaned = cleanAutoName(line);
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

export async function resolveTaskName(input: {
  name?: string | null;
  description?: string | null;
}): Promise<string> {
  const provided = input.name?.trim();
  if (provided) {
    return provided;
  }

  const namingSource = removeTaskContextAttachmentLinks(
    input.description ?? "",
  ).trim();
  if (!namingSource) {
    return UNTITLED_TASK_NAME;
  }

  const generated = (
    await openrouterClient.generateTaskName(namingSource)
  )?.trim();
  if (generated) {
    const cleaned = cleanAutoName(generated);
    if (!isRejectedGeneratedName(generated, cleaned)) {
      return cleaned;
    }
  }

  return fallbackTaskName(namingSource) || UNTITLED_TASK_NAME;
}
