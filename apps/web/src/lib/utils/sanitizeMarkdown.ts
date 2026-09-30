import { MARKDOWN_FENCED_BLOCK_REGEX } from "@sokosumi/utils";
import { defaultSchema, type Options as Schema } from "rehype-sanitize";
import sanitizeHtml from "sanitize-html";

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
    MARKDOWN_FENCED_BLOCK_REGEX,
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
function handleMarkdownReplaces(markdown: string): string {
  // Replace lines containing only three or more dashes, asterisks, or underscores (with optional spaces) with '___'
  return markdown.replace(/^( {0,3}(([-*_])\s?){3,})$/gm, "\n___\n");
}

/** The raw HTML tags a message may carry. */
const RAW_HTML_TAGS = [
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
  "span",
  "u",
];

/** What the markdown parser emits on top of those, GFM included. */
const MARKDOWN_GENERATED_TAGS = [
  "blockquote",
  "del",
  "h4",
  "h5",
  "h6",
  "hr",
  "input",
  "pre",
  "section",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
];

const SPAN_CLASSES = ["text-primary", "font-medium", "whitespace-nowrap"];
// Intentionally omit autoplay — product requires user-started playback.
const MEDIA_ATTRIBUTES = ["src", "controls", "loop", "muted"];

/**
 * The rule the rendered tree is held to, applied right after `rehype-raw`.
 *
 * This is the boundary that makes `<Markdown>` safe. `sanitizeMarkdown` below
 * decides which raw HTML a message may carry, but it reads a string, and it
 * lifts fenced code out by a line rule before it reads. The parser does not
 * always agree about where a fence is: an HTML block opened on the line above
 * runs to the next blank line, so the "fence" under it is raw HTML. Text the
 * string pass never read then comes back as markup. A tree has no such
 * disagreement, because it is what the parser decided.
 *
 * GitHub's schema with the tag list swapped for ours: it already passes what
 * `remark-gfm` generates (task lists, footnotes, table alignment).
 *
 * It guards against DOM clobbering by prefixing every `id` and `name`. A
 * footnote arrives with its `id` and the `href` that points at it already
 * prefixed by `remark-rehype`, so prefixing again breaks the link. Accept only
 * that namespace instead, and no `name` at all.
 */
export const markdownHastSchema: Schema = {
  ...defaultSchema,
  tagNames: [...RAW_HTML_TAGS, ...MARKDOWN_GENERATED_TAGS],
  clobber: [],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []).filter(
        (name) => name !== "id" && name !== "name",
      ),
      ["id", /^user-content-/, "footnote-label"],
    ],
    video: MEDIA_ATTRIBUTES,
    audio: MEDIA_ATTRIBUTES,
    source: ["src"],
    span: [["className", ...SPAN_CLASSES], "dataDirectKind", "dataDirectId"],
  },
  // `sanitize-html`'s own `nonTextTags`: their text goes with the tag.
  strip: ["script", "style", "textarea", "option", "xmp"],
};

const RAW_HTML_ATTRIBUTES = {
  a: ["href"],
  img: ["src", "alt", "title", "width", "height"],
  video: [...MEDIA_ATTRIBUTES, "width", "height"],
  audio: [...MEDIA_ATTRIBUTES, "width", "height"],
  source: ["src"],
  span: ["class", "data-direct-kind", "data-direct-id"],
};
const RAW_HTML_CLASSES = { span: SPAN_CLASSES };

/**
 * The same rule for markdown already rendered to an HTML string, for a
 * renderer that is not `<Markdown>` and so has no tree to hand over.
 *
 * It reads the renderer's output rather than its input, for the reason
 * `markdownHastSchema` reads the tree: the output is what the renderer
 * decided, and a pass over the input can only guess at it.
 */
export function sanitizeRenderedMarkdown(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...RAW_HTML_TAGS, ...MARKDOWN_GENERATED_TAGS],
    allowedAttributes: {
      ...RAW_HTML_ATTRIBUTES,
      a: ["href", "title"],
      code: ["class"],
      input: ["type", "checked", "disabled"],
      ol: ["start"],
      td: ["align"],
      th: ["align"],
    },
    allowedClasses: { ...RAW_HTML_CLASSES, code: ["language-*"] },
    // Every input is a task list's disabled checkbox, as the tree schema's
    // `required` has it.
    transformTags: {
      input: (tagName, attribs) => ({
        tagName,
        attribs: {
          type: "checkbox",
          disabled: "",
          ...("checked" in attribs ? { checked: "" } : {}),
        },
      }),
    },
  });
}

export function sanitizeMarkdown(markdown: string): string {
  const { tokenized, codeBlocks } = tokenizeFencedCodeBlocks(markdown);
  const replacedMarkdown = handleMarkdownReplaces(tokenized);
  const sanitized = sanitizeHtml(replacedMarkdown, {
    allowedTags: RAW_HTML_TAGS,
    allowedAttributes: RAW_HTML_ATTRIBUTES,
    allowedClasses: RAW_HTML_CLASSES,
  });

  // sanitize-html encodes text `>` as `&gt;`. That is correct in HTML and
  // wrong in markdown: `> quoted` must stay a blockquote marker. Unescape
  // before restoring fences so a fenced `&gt;` stays literal.
  return restoreFencedCodeBlocks(sanitized.replaceAll("&gt;", ">"), codeBlocks);
}
