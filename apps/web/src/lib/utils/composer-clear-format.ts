import {
  isChannelLinkSpan,
  isMentionSpan,
} from "@/components/ui/mention-textarea-utils";
import { clearStickyFormatsWithoutDom } from "@/lib/utils/composer-wysiwyg-arrow-exit";

/**
 * Inverse of `htmlToMarkdown`'s `processNode` switch, plus tags `execCommand`
 * writes (`b`/`i`/`font`/styled `span`).
 *
 * Do not derive from `COMPOSER_ALLOWED_TAGS` — that list also holds chips
 * (`span`) and line-break structure (`div`/`p`/`br`) which must not unwrap.
 */
export type ClearFormatRole =
  | "unwrap-inline"
  | "unwrap-block"
  | "unwrap-list"
  | "keep";

export const CLEAR_FORMAT_ROLES: Record<string, ClearFormatRole> = {
  b: "unwrap-inline",
  strong: "unwrap-inline",
  i: "unwrap-inline",
  em: "unwrap-inline",
  u: "unwrap-inline",
  s: "unwrap-inline",
  strike: "unwrap-inline",
  del: "unwrap-inline",
  a: "unwrap-inline",
  font: "unwrap-inline",
  code: "unwrap-inline",

  h1: "unwrap-block",
  h2: "unwrap-block",
  h3: "unwrap-block",
  blockquote: "unwrap-block",
  pre: "unwrap-block",

  ul: "unwrap-list",
  ol: "unwrap-list",
  li: "unwrap-list",

  div: "keep",
  p: "keep",
  br: "keep",
};

export interface ClearComposerFormatResult {
  didChange: boolean;
}

const BLOCK_ANCESTOR_TAGS = new Set([
  "div",
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "pre",
  "blockquote",
]);

function isAtomicChip(node: Node): boolean {
  return isMentionSpan(node) || isChannelLinkSpan(node);
}

function isInsideAtomicChip(node: Node, root: HTMLElement): boolean {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isAtomicChip(current)) return true;
    current = current.parentNode;
  }
  return false;
}

function isStyleWithCssSpan(el: HTMLElement): boolean {
  if (el.tagName !== "SPAN") return false;
  if (isAtomicChip(el)) return false;
  return (
    el.hasAttribute("style") ||
    el.hasAttribute("face") ||
    el.hasAttribute("size")
  );
}

function roleFor(
  el: HTMLElement,
): ClearFormatRole | "atomic" | "unwrap-inline" {
  if (isAtomicChip(el)) return "atomic";
  if (isStyleWithCssSpan(el)) return "unwrap-inline";
  return CLEAR_FORMAT_ROLES[el.tagName.toLowerCase()] ?? "keep";
}

function isFormatTarget(el: HTMLElement): boolean {
  const role = roleFor(el);
  return role !== "keep" && role !== "atomic";
}

function expandCollapsedRange(root: HTMLElement, range: Range): Range {
  if (!range.collapsed) {
    return range.cloneRange();
  }

  let node: Node | null = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (BLOCK_ANCESTOR_TAGS.has(tag)) {
        const expanded = document.createRange();
        expanded.selectNodeContents(node);
        return expanded;
      }
    }
    node = node.parentNode;
  }

  const expanded = document.createRange();
  expanded.selectNodeContents(root);
  return expanded;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  if (typeof range.intersectsNode === "function") {
    return range.intersectsNode(node);
  }

  try {
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0
    );
  } catch {
    return false;
  }
}

function collectFormatTargets(root: HTMLElement, range: Range): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const targets: HTMLElement[] = [];

  function addTarget(el: HTMLElement): void {
    if (seen.has(el) || el === root) return;
    if (!isFormatTarget(el)) return;
    seen.add(el);
    targets.push(el);
  }

  let ancestor: Node | null = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) {
    ancestor = ancestor.parentNode;
  }
  while (ancestor && ancestor !== root) {
    if (ancestor instanceof HTMLElement) {
      addTarget(ancestor);
    }
    ancestor = ancestor.parentNode;
  }

  const commonElement =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;

  if (commonElement && root.contains(commonElement)) {
    for (const node of commonElement.querySelectorAll("*")) {
      if (!(node instanceof HTMLElement)) continue;
      if (isAtomicChip(node) || isInsideAtomicChip(node, root)) continue;
      if (rangeIntersectsNode(range, node)) {
        addTarget(node);
      }
    }
  }

  return targets;
}

function deepestFirst(a: HTMLElement, b: HTMLElement): number {
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return 1;
  if (pos & Node.DOCUMENT_POSITION_CONTAINS) return -1;
  return 0;
}

function unwrapKeepChildren(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  el.remove();
}

function unwrapListPiece(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "li") {
    const parent = el.parentNode;
    if (!parent) return;

    const hasFollowingLi =
      el.nextElementSibling?.tagName.toLowerCase() === "li";
    const movedNodes: Node[] = [];

    while (el.firstChild) {
      const child = el.firstChild;
      movedNodes.push(child);
      parent.insertBefore(child, el);
    }

    if (hasFollowingLi && movedNodes.length > 0) {
      const lastMoved = movedNodes[movedNodes.length - 1];
      const br = document.createElement("br");
      if (lastMoved.nextSibling) {
        parent.insertBefore(br, lastMoved.nextSibling);
      } else {
        parent.appendChild(br);
      }
    }

    el.remove();
    return;
  }

  unwrapKeepChildren(el);
}

function unwrapByRole(
  el: HTMLElement,
  role: ClearFormatRole | "atomic" | "unwrap-inline",
): void {
  if (role === "atomic" || role === "keep") return;
  if (role === "unwrap-list") {
    unwrapListPiece(el);
    return;
  }
  unwrapKeepChildren(el);
}

function insertRangeMarker(range: Range, atStart: boolean): Comment {
  const marker = document.createComment("clear-format-boundary");
  const boundary = range.cloneRange();
  boundary.collapse(atStart);
  boundary.insertNode(marker);
  return marker;
}

function restoreSelectionFromMarkers(
  startMarker: Comment,
  endMarker: Comment,
): void {
  const newRange = document.createRange();
  newRange.setStartAfter(startMarker);
  newRange.setEndBefore(endMarker);
  startMarker.remove();
  endMarker.remove();

  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(newRange);
}

/**
 * Strip format tags that intersect `range` inside `root`.
 *
 * Does not call `document.execCommand`.
 */
export function clearComposerFormat(
  root: HTMLElement,
  range: Range,
): ClearComposerFormatResult {
  if (!root.contains(range.commonAncestorContainer)) {
    return { didChange: false };
  }

  const working = expandCollapsedRange(root, range);
  const targets = collectFormatTargets(root, working);
  const endMarker = insertRangeMarker(working, false);
  const startMarker = insertRangeMarker(working, true);

  let didChange = false;
  targets.sort(deepestFirst);

  for (const el of targets) {
    if (!root.contains(el)) continue;
    if (isInsideAtomicChip(el, root) || isAtomicChip(el)) continue;
    const role = roleFor(el);
    if (role === "atomic" || role === "keep") continue;
    unwrapByRole(el, role);
    didChange = true;
  }

  restoreSelectionFromMarkers(startMarker, endMarker);

  if (didChange) {
    clearStickyFormatsWithoutDom(root);
  }

  return { didChange };
}
