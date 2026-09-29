const HTML_TAG_REGEX = /<[^>]*>/g;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\([^)]+\)/g;
const CODE_FENCE_REGEX = /```([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`]+)`/g;
const MARKDOWN_TOKENS_REGEX = /[*_~#>]/g;
const MULTISPACE_REGEX = /\s+/g;

// Strip HTML tags repeatedly: a single pass can leave a partial tag behind
// when tags are nested (e.g. `<scr<script>ipt>`), which trips
// js/incomplete-multi-character-sanitization. Loop until the result stabilises.
function stripHtmlTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(HTML_TAG_REGEX, "");
  } while (current !== previous);
  return current;
}

function stripMarkdownFromText(text: string): string {
  return stripHtmlTags(
    text
      .replace(MARKDOWN_IMAGE_REGEX, "$1")
      .replace(MARKDOWN_LINK_REGEX, "$1")
      .replace(CODE_FENCE_REGEX, "$1")
      .replace(INLINE_CODE_REGEX, "$1"),
  )
    .replace(MARKDOWN_TOKENS_REGEX, "")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

export function stripMarkdownToText(input?: string | null): string | null {
  if (input === null || input === undefined) {
    return null;
  }

  return stripMarkdownFromText(input);
}

/**
 * Plain text for a one-line name (task, schedule): removes paired emphasis,
 * inline code, links and a leading heading marker, but keeps lone `_`, `#`,
 * `*` or `>` that belong to the name (`fix_login`, `Issue #42`).
 */
export function stripInlineMarkdown(name: string): string {
  const plain = name
    .replace(MARKDOWN_IMAGE_REGEX, "$1")
    .replace(MARKDOWN_LINK_REGEX, "$1")
    .replace(INLINE_CODE_REGEX, "$1")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?![\w])/g, "$1$2")
    .replace(/^#{1,6}\s+/, "")
    .replace(MULTISPACE_REGEX, " ")
    .trim();

  return plain || name;
}
