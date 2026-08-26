import sanitizeHtml from "sanitize-html";

const FENCED_CODE_BLOCK_REGEX =
  /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;

function createUniqueCodeBlockToken(
  source: string,
  index: number,
  usedTokens: Set<string>,
): string {
  let suffix = 0;
  let token = `@@SANITIZE_CODEBLOCKTOKEN_${index}_${suffix}@@`;

  while (source.includes(token) || usedTokens.has(token)) {
    suffix += 1;
    token = `@@SANITIZE_CODEBLOCKTOKEN_${index}_${suffix}@@`;
  }

  usedTokens.add(token);
  return token;
}

function tokenizeFencedCodeBlocks(markdown: string) {
  const codeBlocks: Array<{ token: string; block: string }> = [];
  const usedTokens = new Set<string>();

  const tokenized = markdown.replace(
    FENCED_CODE_BLOCK_REGEX,
    (fullMatch: string, leadingNewline: string) => {
      const token = createUniqueCodeBlockToken(
        markdown,
        codeBlocks.length,
        usedTokens,
      );
      codeBlocks.push({
        token,
        block: fullMatch.slice(leadingNewline.length),
      });
      return `${leadingNewline}${token}`;
    },
  );

  return { tokenized, codeBlocks };
}

function restoreFencedCodeBlocks(
  markdown: string,
  codeBlocks: Array<{ token: string; block: string }>,
) {
  return codeBlocks.reduce((result, codeBlock) => {
    return result.replace(codeBlock.token, () => codeBlock.block);
  }, markdown);
}

// Handles markdown replacements for custom rules
export function handleMarkdownReplaces(markdown: string): string {
  // Replace lines containing only three or more dashes, asterisks, or underscores (with optional spaces) with '___'
  return markdown.replace(/^( {0,3}(([-*_])\s?){3,})$/gm, "\n___\n");
}

export function sanitizeMarkdown(markdown: string): string {
  const { tokenized, codeBlocks } = tokenizeFencedCodeBlocks(markdown);
  const replacedMarkdown = handleMarkdownReplaces(tokenized);
  const sanitized = sanitizeHtml(replacedMarkdown, {
    allowedTags: [
      "b",
      "i",
      "em",
      "strong",
      "a",
      "source",
      "p",
      "h1",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "br",
      "img",
      "video",
      "audio",
      "code",
      "mark",
      "span",
      "u",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "title", "width", "height"],
      // Intentionally omit autoplay — product requires user-started playback.
      video: ["src", "controls", "loop", "muted", "width", "height"],
      audio: ["src", "controls", "loop", "muted", "width", "height"],
      source: ["src"],
      mark: ["class"],
      span: ["class", "data-direct-kind", "data-direct-id"],
    },
    allowedClasses: {
      mark: ["bg-primary/50", "text-foreground", "rounded-sm", "px-0.5"],
      span: ["text-primary", "font-medium", "whitespace-nowrap"],
    },
  });

  return restoreFencedCodeBlocks(sanitized, codeBlocks);
}
