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
