"use client";

import { parseMentions } from "@/lib/utils/mention-parser";

export interface MentionDisplay {
  displayName: string;
  isKnown: boolean;
}

export type MentionDisplayResolver = (
  mentionKey: string,
  mentionSlug: string,
) => MentionDisplay;

export interface MentionSpanStyleOptions {
  mentionClassName?: string;
  unknownMentionClassName?: string;
}

export function isWhitespaceChar(char: string): boolean {
  return char.trim() === "";
}

export function shouldAppendTrailingSpace(
  nextChar: string | undefined,
): boolean {
  // Preserve existing behavior: insert a trailing space at end-of-text.
  if (nextChar === undefined || nextChar === "") return true;
  // Avoid double-spacing when we're inserting before existing whitespace/newlines.
  return !isWhitespaceChar(nextChar);
}

export function getMentionToken(
  mentionKey: string,
  mentionSlug: string,
): string {
  return `@${mentionKey}:${mentionSlug}`;
}

export function buildMentionToken(
  mentionKey: string,
  mentionSlug: string,
  nextChar: string | undefined,
): string {
  const token = getMentionToken(mentionKey, mentionSlug);
  return `${token}${shouldAppendTrailingSpace(nextChar) ? " " : ""}`;
}

export function isMentionSpan(node: Node): node is HTMLSpanElement {
  if (!(node instanceof HTMLSpanElement)) return false;
  return Boolean(node.dataset.mentionKey && node.dataset.mentionSlug);
}

export function isLineBreak(node: Node): node is HTMLBRElement {
  return node.nodeType === Node.ELEMENT_NODE && node.nodeName === "BR";
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (isMentionSpan(node)) {
    return getMentionToken(
      node.dataset.mentionKey ?? "",
      node.dataset.mentionSlug ?? "",
    );
  }

  if (isLineBreak(node)) {
    return "\n";
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    let result = "";
    node.childNodes.forEach((child) => {
      result += serializeNode(child);
    });
    return result;
  }

  return "";
}

function appendTextWithNewlines(parent: Node, text: string): void {
  if (text === "") return;
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (part !== "") {
      parent.appendChild(document.createTextNode(part));
    }
    if (index < parts.length - 1) {
      parent.appendChild(document.createElement("br"));
    }
  });
}

export function serializeEditorText(root: HTMLElement): string {
  let result = "";
  root.childNodes.forEach((child) => {
    result += serializeNode(child);
  });
  return result;
}

export function createMentionSpan(
  mentionKey: string,
  mentionSlug: string,
  displayName: string,
  isKnown: boolean,
  options?: MentionSpanStyleOptions,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.mentionKey = mentionKey;
  span.dataset.mentionSlug = mentionSlug;
  span.textContent = `@${displayName}`;
  span.contentEditable = "false";
  if (options?.mentionClassName) {
    span.className = options.mentionClassName;
  }
  if (!isKnown && options?.unknownMentionClassName) {
    span.className =
      `${span.className} ${options.unknownMentionClassName}`.trim();
  }
  return span;
}

export function setEditorFromRaw(
  root: HTMLElement,
  raw: string,
  resolveDisplay: MentionDisplayResolver,
  options?: MentionSpanStyleOptions,
): void {
  const fragment = document.createDocumentFragment();
  const matches = parseMentions(raw);
  let lastIndex = 0;

  for (const match of matches) {
    if (match.start > lastIndex) {
      appendTextWithNewlines(fragment, raw.slice(lastIndex, match.start));
    }

    const { displayName, isKnown } = resolveDisplay(match.id, match.slug);
    const mentionSpan = createMentionSpan(
      match.id,
      match.slug,
      displayName,
      isKnown,
      options,
    );
    fragment.appendChild(mentionSpan);

    lastIndex = match.end;
  }

  if (lastIndex < raw.length) {
    appendTextWithNewlines(fragment, raw.slice(lastIndex));
  }

  root.replaceChildren(fragment);
}
