/**
 * Active mark/block state at the caret (or selection) inside the WYSIWYG
 * composer — drives toolbar pressed styling like Slack.
 */

export interface ComposerActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  codeBlock: boolean;
  quote: boolean;
  bulletList: boolean;
  numberedList: boolean;
  link: boolean;
}

export const EMPTY_COMPOSER_ACTIVE_FORMATS: ComposerActiveFormats = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  codeBlock: false,
  quote: false,
  bulletList: false,
  numberedList: false,
  link: false,
};

const BOLD_TAGS = new Set(["STRONG", "B"]);
const ITALIC_TAGS = new Set(["EM", "I"]);
const UNDERLINE_TAGS = new Set(["U"]);
const STRIKE_TAGS = new Set(["S", "STRIKE", "DEL"]);
const QUOTE_TAGS = new Set(["BLOCKQUOTE"]);
const BULLET_LIST_TAGS = new Set(["UL"]);
const NUMBERED_LIST_TAGS = new Set(["OL"]);
const LINK_TAGS = new Set(["A"]);

function selectionAnchorInEditor(
  selection: Selection,
  editor: HTMLElement,
): Node | null {
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const anchorElement =
    anchor.nodeType === Node.TEXT_NODE
      ? anchor.parentElement
      : (anchor as Element);
  if (!anchorElement || !editor.contains(anchorElement)) return null;
  return anchor;
}

function closestElement(
  node: Node | null,
  predicate: (element: HTMLElement) => boolean,
): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
}

function hasTag(node: Node | null, tags: ReadonlySet<string>): boolean {
  return Boolean(closestElement(node, (element) => tags.has(element.tagName)));
}

function queryCommandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/**
 * Read which formats apply at the current selection inside `editor`.
 * Returns empty formats when there is no in-editor selection.
 */
export function getComposerActiveFormats(
  editor: HTMLElement | null,
): ComposerActiveFormats {
  if (!editor) return { ...EMPTY_COMPOSER_ACTIVE_FORMATS };

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { ...EMPTY_COMPOSER_ACTIVE_FORMATS };
  }

  const anchor = selectionAnchorInEditor(selection, editor);
  if (!anchor) return { ...EMPTY_COMPOSER_ACTIVE_FORMATS };

  const probeNode = selection.isCollapsed
    ? anchor
    : selection.getRangeAt(0).commonAncestorContainer;

  const pre = closestElement(probeNode, (element) => element.tagName === "PRE");
  const code = closestElement(
    probeNode,
    (element) => element.tagName === "CODE",
  );

  return {
    bold: hasTag(probeNode, BOLD_TAGS) || queryCommandActive("bold"),
    italic: hasTag(probeNode, ITALIC_TAGS) || queryCommandActive("italic"),
    underline:
      hasTag(probeNode, UNDERLINE_TAGS) || queryCommandActive("underline"),
    strikethrough:
      hasTag(probeNode, STRIKE_TAGS) || queryCommandActive("strikeThrough"),
    code: Boolean(code) && !pre,
    codeBlock: Boolean(pre),
    quote: hasTag(probeNode, QUOTE_TAGS),
    bulletList:
      hasTag(probeNode, BULLET_LIST_TAGS) ||
      queryCommandActive("insertUnorderedList"),
    numberedList:
      hasTag(probeNode, NUMBERED_LIST_TAGS) ||
      queryCommandActive("insertOrderedList"),
    link: hasTag(probeNode, LINK_TAGS),
  };
}
