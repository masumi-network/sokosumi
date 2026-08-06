"use client";

import { parseMentions } from "@/lib/utils/mention-parser";

export interface MentionRecordEntry<TData = unknown> {
  value: string;
  slug?: string | null;
  data?: TData;
}

export interface NormalizedMention<TData = unknown> {
  key: string;
  value: string;
  slug: string;
  data?: TData;
}

/** Optional sectioned mention picker groups (e.g. People / Coworkers). */
export interface MentionSuggestionGroup<TData = unknown> {
  id: string;
  label: string;
  items: NormalizedMention<TData>[];
}

export interface TriggerPosition {
  top: number;
  left: number;
  side: "top" | "bottom";
  maxHeight: number;
  width?: number;
}

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

export const POPUP_HEIGHT_PX = 240;
export const POPUP_MIN_HEIGHT_PX = 80;
export const POPUP_WIDTH_PX = 288;
export const VIEWPORT_PADDING_PX = 8;
/** Gap between mention picker bottom and composer card top. */
export const MENTION_COMPOSER_GAP_PX = 4;
/**
 * Leave room above the focused composer for the anchored suggestion list
 * when mobile browsers scroll the caret into the visual viewport.
 */
export const MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX =
  POPUP_HEIGHT_PX + MENTION_COMPOSER_GAP_PX + VIEWPORT_PADDING_PX;
export const MENTION_CLASSNAME =
  "text-primary cursor-pointer font-semibold hover:underline";
export const UNKNOWN_MENTION_CLASSNAME = "opacity-80";

export function filterNormalizedMentions<TData = unknown>(
  items: readonly NormalizedMention<TData>[],
  query: string,
): NormalizedMention<TData>[] {
  const q = query.toLowerCase();
  if (q.length === 0) {
    return [...items];
  }

  const prefixMatches: NormalizedMention<TData>[] = [];
  const includesMatches: NormalizedMention<TData>[] = [];

  for (const mention of items) {
    const value = mention.value.toLowerCase();
    const slug = mention.slug.toLowerCase();

    if (value.startsWith(q) || slug.startsWith(q)) {
      prefixMatches.push(mention);
      continue;
    }
    if (value.includes(q) || slug.includes(q)) {
      includesMatches.push(mention);
    }
  }

  return [...prefixMatches, ...includesMatches];
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

export function deslugifyMentionSlug(slug: string): string {
  return slug.replace(/-/g, " ");
}

export function getMentionTokenLength(span: HTMLSpanElement): number {
  return getMentionToken(
    span.dataset.mentionKey ?? "",
    span.dataset.mentionSlug ?? "",
  ).length;
}

export function getSerializedLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }

  if (isMentionSpan(node)) {
    return getMentionTokenLength(node);
  }

  if (isLineBreak(node)) {
    return 1;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    let result = 0;
    node.childNodes.forEach((child) => {
      result += getSerializedLength(child);
    });
    return result;
  }

  return 0;
}

export function getSerializedOffset(
  root: HTMLElement,
  targetNode: Node,
  targetOffset: number,
): number {
  let offset = 0;

  function traverse(node: Node): boolean {
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += targetOffset;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const children = Array.from(node.childNodes);
        for (let index = 0; index < targetOffset; index += 1) {
          offset += getSerializedLength(children[index]);
        }
      }
      return true;
    }

    if (
      node.nodeType === Node.TEXT_NODE ||
      isMentionSpan(node) ||
      isLineBreak(node)
    ) {
      offset += getSerializedLength(node);
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(node.childNodes)) {
        if (traverse(child)) return true;
      }
    }

    return false;
  }

  traverse(root);
  return offset;
}

export function getCaretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  return getSerializedOffset(root, range.endContainer, range.endOffset);
}

export function serializeEditor(
  root: HTMLElement,
): { text: string; caret: number } {
  const serializedText = serializeEditorText(root);
  const caret = getCaretOffset(root) ?? serializedText.length;
  return { text: serializedText, caret };
}

export function findPositionForOffset(
  root: HTMLElement,
  targetOffset: number,
): { node: Node; offset: number } {
  let remaining = targetOffset;

  function walk(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        return { node, offset: remaining };
      }
      remaining -= length;
      return null;
    }

    if (isMentionSpan(node)) {
      const length = getMentionTokenLength(node);
      if (remaining <= length) {
        const parent = node.parentNode ?? root;
        const index = Array.from(parent.childNodes).indexOf(node);
        return {
          node: parent,
          offset: remaining === length ? index + 1 : index,
        };
      }
      remaining -= length;
      return null;
    }

    if (isLineBreak(node)) {
      if (remaining <= 1) {
        const parent = node.parentNode ?? root;
        const index = Array.from(parent.childNodes).indexOf(node);
        return { node: parent, offset: remaining === 1 ? index + 1 : index };
      }
      remaining -= 1;
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        const result = walk(child);
        if (result) return result;
      }
    }

    return null;
  }

  return walk(root) ?? { node: root, offset: root.childNodes.length };
}

export function setCaretAfterNode(root: HTMLElement, node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, node.textContent?.length ?? 0);
  } else {
    const parent = node.parentNode ?? root;
    const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
    range.setStart(parent, index + 1);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function getActiveTrigger(
  text: string,
  caret: number,
): { query: string; triggerStart: number } | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  if (clampedCaret === 0) return null;

  let tokenStart = clampedCaret;
  while (tokenStart > 0 && !isWhitespaceChar(text[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }

  // Caret must be at or after the first character after "@". If caret is
  // before "@", this is not an active mention trigger.
  if (tokenStart === clampedCaret) return null;

  if (text[tokenStart] !== "@") return null;

  const query = text.slice(tokenStart + 1, clampedCaret);
  // Serialized mention tokens use ":" (e.g., @agent-id:agent-slug). We should
  // only activate suggestions for in-progress user queries, not persisted
  // mention token text.
  if (query.includes("@") || query.includes(":")) return null;

  return { query, triggerStart: tokenStart };
}

const EMOJI_SHORTCODE_QUERY_PATTERN = /^[a-z0-9_+-]*$/i;

export const EMOJI_SHORTCODE_MIN_QUERY_LENGTH = 2;

/**
 * Detect in-progress emoji shortcode at caret.
 * Token is start/whitespace-delimited, leading `:`, query = [a-z0-9_+-]*.
 * Does not share logic with getActiveTrigger (mentions keep rejecting `:`).
 */
export function getActiveEmojiTrigger(
  text: string,
  caret: number,
): { query: string; triggerStart: number } | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  if (clampedCaret === 0) return null;

  let tokenStart = clampedCaret;
  while (tokenStart > 0 && !isWhitespaceChar(text[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }

  if (tokenStart === clampedCaret) return null;
  if (text[tokenStart] !== ":") return null;

  const query = text.slice(tokenStart + 1, clampedCaret);
  if (query.includes("@") || query.includes(":")) return null;
  if (!EMOJI_SHORTCODE_QUERY_PATTERN.test(query)) return null;
  if (query.length < EMOJI_SHORTCODE_MIN_QUERY_LENGTH) return null;

  return { query: query.toLowerCase(), triggerStart: tokenStart };
}

export function getPopupPositionFromRect(rect: DOMRect): TriggerPosition {
  // Measure against the visual viewport so an open virtual keyboard counts as
  // unavailable space. `interactiveWidget: "resizes-content"` shrinks the
  // layout viewport on Android, but iOS Safari resizes only the visual one, so
  // `innerHeight` alone would place the suggestions behind the keyboard.
  // offsetTop/offsetLeft put both edges back into the client coordinate space
  // that `rect` uses.
  const visual = window.visualViewport;
  const viewportTop = visual ? visual.offsetTop : 0;
  const viewportBottom = visual
    ? visual.offsetTop + visual.height
    : window.innerHeight;
  const viewportWidth = visual ? visual.width : window.innerWidth;
  const belowSpace = viewportBottom - rect.bottom - VIEWPORT_PADDING_PX;
  const aboveSpace = rect.top - viewportTop - VIEWPORT_PADDING_PX;
  // Prefer above when the preferred popup height cannot fit below and there is
  // more room above (bottom composers). Cap used to be min(240, 96), which kept
  // lists growing into a thin strip under the caret with little scroll room.
  const side =
    belowSpace < POPUP_HEIGHT_PX && aboveSpace > belowSpace ? "top" : "bottom";
  const maxHeight = Math.min(
    POPUP_HEIGHT_PX,
    Math.max(
      POPUP_MIN_HEIGHT_PX,
      side === "top" ? aboveSpace - 4 : belowSpace - 4,
    ),
  );
  const top = side === "top" ? rect.top - 4 : rect.bottom + 4;
  let left = rect.left;

  if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;
  const maxLeft = viewportWidth - POPUP_WIDTH_PX - VIEWPORT_PADDING_PX;
  if (left > maxLeft && maxLeft > 0) left = maxLeft;

  return { top, left, side, maxHeight };
}

export function getMentionPopupPositionFromAnchorRect(
  anchorRect: DOMRect,
): TriggerPosition {
  const visual = window.visualViewport;
  // Visual viewport edges (not layout 0) — pinch-zoom + pan shift offsetLeft/Top.
  const viewportTop = visual ? visual.offsetTop : 0;
  const viewportLeft = visual ? visual.offsetLeft : 0;
  const viewportWidth = visual ? visual.width : window.innerWidth;
  const aboveSpace =
    anchorRect.top -
    viewportTop -
    VIEWPORT_PADDING_PX -
    MENTION_COMPOSER_GAP_PX;
  // Never floor above available space: list uses translateY(-100%), so a
  // forced 80px min would clip the top of the picker when the keyboard /
  // attachments leave less than 80px above the composer.
  const maxHeight = Math.min(POPUP_HEIGHT_PX, Math.max(0, aboveSpace));
  const top = anchorRect.top - MENTION_COMPOSER_GAP_PX;
  let left = anchorRect.left;
  let width = anchorRect.width;

  const minLeft = viewportLeft + VIEWPORT_PADDING_PX;
  const maxRight = viewportLeft + viewportWidth - VIEWPORT_PADDING_PX;
  if (left < minLeft) {
    width -= minLeft - left;
    left = minLeft;
  }
  if (left + width > maxRight) {
    width = maxRight - left;
  }
  if (width < 0) width = 0;

  return { top, left, side: "top", maxHeight, width };
}

export function getCaretRect(root: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width !== 0 || rect.height !== 0) return rect;

  const marker = document.createElement("span");
  marker.textContent = "\u200b";

  const markerRange = range.cloneRange();
  markerRange.collapse(true);
  markerRange.insertNode(marker);
  const markerRect = marker.getBoundingClientRect();
  marker.remove();

  selection.removeAllRanges();
  selection.addRange(range);

  return markerRect;
}
