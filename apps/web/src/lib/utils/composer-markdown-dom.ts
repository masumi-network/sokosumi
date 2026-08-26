import {
  type ChannelLinkIdentity,
  collectChannelLinksInMarkdown,
  escapeMarkdownLinkUrl,
  replaceMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";

import {
  createChannelLinkSpan,
  createMentionSpan,
  getChannelLinkToken,
  getMentionToken,
  isChannelLinkSpan,
  isMentionSpan,
  MENTION_CLASSNAME,
  UNKNOWN_MENTION_CLASSNAME,
} from "@/components/ui/mention-textarea-utils";
import {
  getBacktickFence,
  isBlockMarkdownElement,
  normalizeUrl,
} from "@/lib/utils/markdown-editor-utils";
import { parseMentions } from "@/lib/utils/mention-parser";

const PERSISTED_INTERNAL_MENTION_REGEX = /@@MENTION_?(\d+)@@/g;
const INTERNAL_MENTION_PLACEHOLDER_PREFIX = "unknown-mention-";

function internalMentionPlaceholderKey(index: string): string {
  return `${INTERNAL_MENTION_PLACEHOLDER_PREFIX}${index}`;
}

function internalMentionPlaceholderToken(index: string): string {
  const key = internalMentionPlaceholderKey(index);
  return `@${key}:${key}`;
}

function isInternalMentionPlaceholderId(id: string): boolean {
  if (!id.startsWith(INTERNAL_MENTION_PLACEHOLDER_PREFIX)) {
    return false;
  }
  return /^\d+$/.test(id.slice(INTERNAL_MENTION_PLACEHOLDER_PREFIX.length));
}

export interface MentionDisplayResolution {
  displayName: string;
  isKnown: boolean;
}

export type ResolveMentionDisplay = (
  mentionKey: string,
  mentionSlug: string,
) => MentionDisplayResolution;

export interface MarkdownToHtmlOptions {
  channelLinks?: readonly ChannelLinkIdentity[];
  /**
   * When false, unknown `@id:slug` tokens stay raw (chat transcript rule).
   * Default true so task/other composers still chip unknowns.
   * Internal `@@MENTION@@` salvage placeholders always wrap.
   */
  wrapUnknownMentions?: boolean;
}

function normalizePersistedInternalMentions(text: string): string {
  return text.replace(
    PERSISTED_INTERNAL_MENTION_REGEX,
    (_match, mentionIndex: string) =>
      internalMentionPlaceholderToken(mentionIndex),
  );
}

function defaultResolveMentionDisplay(
  _mentionKey: string,
  mentionSlug: string,
): MentionDisplayResolution {
  return {
    displayName: mentionSlug,
    isKnown: false,
  };
}

/**
 * Markdown → HTML for contentEditable composers.
 * Supports bold/italic/strike/code/underline (`<u>`), links, lists,
 * headings, fenced code, blockquotes (`> `), and @mentions.
 */
export function markdownToHtml(
  text: string,
  resolveMentionDisplay: ResolveMentionDisplay = defaultResolveMentionDisplay,
  options: MarkdownToHtmlOptions = {},
): string {
  if (!text) return "";

  const underlineTokens: Array<{ token: string; html: string }> = [];
  const withUnderlineTokens = normalizePersistedInternalMentions(text).replace(
    /<u>([\s\S]*?)<\/u>/gi,
    (_match, inner: string) => {
      const token = `@@UNDERLINETOKEN${underlineTokens.length}@@`;
      const escapedInner = inner
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      underlineTokens.push({
        token,
        html: `<u>${escapedInner}</u>`,
      });
      return token;
    },
  );

  const escaped = withUnderlineTokens
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const codeBlocks: Array<{ token: string; html: string }> = [];
  const withCodeBlockTokens = escaped.replace(
    /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g,
    (
      _match,
      leadingNewline: string,
      fence: string,
      info: string,
      code: string,
    ) => {
      const token = `@@CODEBLOCKTOKEN${codeBlocks.length}@@`;
      const language = info.trim();
      const html = `<pre><code${
        language ? ` data-language="${language}"` : ""
      }>${code}</code></pre>`;
      codeBlocks.push({ token, html });
      return `${leadingNewline}${token}`;
    },
  );

  const linkTokens: Array<{ token: string; html: string }> = [];
  const withLinkTokens = replaceMarkdownLinks(
    withCodeBlockTokens,
    ({ match, text: label, rawUrl }) => {
      const normalizedUrl = normalizeUrl(unescapeMarkdownLinkUrl(rawUrl));
      if (!normalizedUrl) {
        return match;
      }

      const token = `@@LINKTOKEN${linkTokens.length}@@`;
      linkTokens.push({
        token,
        html: `<a href="${normalizedUrl}">${label}</a>`,
      });
      return token;
    },
  );

  const mentionTokens: Array<{ token: string; html: string }> = [];
  let withMentionTokens = withLinkTokens;
  const parsedMentions = parseMentions(withLinkTokens);
  if (parsedMentions.length > 0) {
    let lastIndex = 0;
    let rebuilt = "";

    for (const mention of parsedMentions) {
      if (mention.start > lastIndex) {
        rebuilt += withLinkTokens.slice(lastIndex, mention.start);
      }

      const rawMentionToken = withLinkTokens.slice(mention.start, mention.end);
      if (rawMentionToken.startsWith("@@")) {
        rebuilt += rawMentionToken;
        lastIndex = mention.end;
        continue;
      }

      const { displayName, isKnown } = resolveMentionDisplay(
        mention.id,
        mention.slug,
      );
      const isInternalPlaceholder = isInternalMentionPlaceholderId(mention.id);
      if (
        !isKnown &&
        !isInternalPlaceholder &&
        options.wrapUnknownMentions === false
      ) {
        rebuilt += rawMentionToken;
        lastIndex = mention.end;
        continue;
      }

      const token = `@@MENTIONTOKEN${mentionTokens.length}@@`;
      const mentionSpan = createMentionSpan(
        mention.id,
        mention.slug,
        displayName,
        isKnown,
        {
          mentionClassName: MENTION_CLASSNAME,
          unknownMentionClassName: UNKNOWN_MENTION_CLASSNAME,
        },
      );
      mentionTokens.push({
        token,
        html: mentionSpan.outerHTML,
      });
      rebuilt += token;
      lastIndex = mention.end;
    }

    if (lastIndex < withLinkTokens.length) {
      rebuilt += withLinkTokens.slice(lastIndex);
    }

    withMentionTokens = rebuilt;
  }

  const channelTokens: Array<{ token: string; html: string }> = [];
  let withChannelTokens = withMentionTokens;
  const channelLinks = options.channelLinks ?? [];
  if (channelLinks.length > 0) {
    const matches = collectChannelLinksInMarkdown(
      withMentionTokens,
      channelLinks,
    );
    if (matches.length > 0) {
      let lastIndex = 0;
      let rebuilt = "";
      for (const match of matches) {
        if (match.start > lastIndex) {
          rebuilt += withMentionTokens.slice(lastIndex, match.start);
        }
        const token = `@@CHANNELTOKEN${channelTokens.length}@@`;
        const label = match.label.startsWith("#")
          ? match.label.slice(1)
          : match.label;
        const channelSpan = createChannelLinkSpan(label, {
          className: MENTION_CLASSNAME,
        });
        channelTokens.push({ token, html: channelSpan.outerHTML });
        rebuilt += token;
        lastIndex = match.end;
      }
      if (lastIndex < withMentionTokens.length) {
        rebuilt += withMentionTokens.slice(lastIndex);
      }
      withChannelTokens = rebuilt;
    }
  }

  const html = withChannelTokens
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^[-*] (.+)$/gm, "<ul><li>$1</li></ul>")
    .replace(/^(\d+)\. (.+)$/gm, "<ol><li>$2</li></ol>")
    .replace(/\n/g, "<br>");

  const withRestoredMentions = mentionTokens.reduce((result, mention) => {
    return result.replace(mention.token, () => mention.html);
  }, html);

  const withRestoredChannels = channelTokens.reduce((result, channel) => {
    return result.replace(channel.token, () => channel.html);
  }, withRestoredMentions);

  const withRestoredLinks = linkTokens.reduce((result, link) => {
    return result.replace(link.token, () => link.html);
  }, withRestoredChannels);

  const withRestoredCode = codeBlocks.reduce((result, block) => {
    return result.replace(block.token, () => block.html);
  }, withRestoredLinks);

  return underlineTokens.reduce((result, underline) => {
    return result.replace(underline.token, () => underline.html);
  }, withRestoredCode);
}

function getCodeContent(codeContainer: HTMLElement): string {
  const text = codeContainer.innerText ?? codeContainer.textContent ?? "";
  return text.replace(/\r/g, "");
}

function getCodeLanguage(codeElement: HTMLElement): string {
  const dataLanguage = codeElement.dataset.language?.trim() ?? "";
  if (dataLanguage) return dataLanguage;

  const classLanguage =
    codeElement.className
      .split(/\s+/)
      .find((className) => className.startsWith("language-"))
      ?.replace("language-", "")
      .trim() ?? "";

  return classLanguage;
}

function serializeFencedCode(
  codeContent: string,
  language: string | undefined,
): string {
  const fence = getBacktickFence(codeContent);
  const infoString = language?.trim();
  const fenceHeader = infoString ? `${fence}${infoString}` : fence;
  return `${fenceHeader}\n${codeContent}\n${fence}\n`;
}

function appendChildMarkdown(
  acc: string,
  child: Node,
  childMarkdown: string,
): string {
  if (!childMarkdown) return acc;
  if (child.nodeType !== Node.ELEMENT_NODE) {
    return acc + childMarkdown;
  }

  const childElement = child as HTMLElement;
  const childTag = childElement.tagName.toLowerCase();
  const shouldSeparateAsBlock = isBlockMarkdownElement(childTag, childMarkdown);

  if (shouldSeparateAsBlock && acc.length > 0 && !acc.endsWith("\n")) {
    return `${acc}\n${childMarkdown}`;
  }

  return acc + childMarkdown;
}

function serializeBlockquote(content: string): string {
  const normalized = content.replace(/\r/g, "").replace(/\n$/, "");
  if (!normalized) return "> \n";
  return `${normalized
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n`;
}

/**
 * Put leading/trailing whitespace outside inline markers so CommonMark
 * (room Markdown) and the lenient composer regex stay in sync.
 * `<strong>hi </strong>` → `**hi** ` not `**hi **`.
 */
export function wrapInlineMarkdownMarker(
  content: string,
  open: string,
  close: string,
): string {
  const leadingMatch = content.match(/^\s*/);
  const trailingMatch = content.match(/\s*$/);
  const leading = leadingMatch?.[0] ?? "";
  const trailing = trailingMatch?.[0] ?? "";
  const inner = content.slice(leading.length, content.length - trailing.length);
  if (!inner) return content;
  return `${leading}${open}${inner}${close}${trailing}`;
}

/**
 * Rewrite loose emphasis like `**hi **` / `_hi _` / `~~hi ~~` into
 * CommonMark-valid markers with spaces moved outside. Used when rendering
 * so older persisted messages still show as bold/italic/strike.
 */
export function normalizeLooseInlineMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  return markdown
    .replace(
      /\*\*(\s*)(.+?)(\s*)\*\*/g,
      (_match, leading: string, inner: string, trailing: string) =>
        `${leading}**${inner}**${trailing}`,
    )
    .replace(
      /~~(\s*)(.+?)(\s*)~~/g,
      (_match, leading: string, inner: string, trailing: string) =>
        `${leading}~~${inner}~~${trailing}`,
    )
    .replace(
      /(^|[^\\])_(\s*)(.+?)(\s*)_/g,
      (
        _match,
        prefix: string,
        leading: string,
        inner: string,
        trailing: string,
      ) => `${prefix}${leading}_${inner}_${trailing}`,
    );
}

/** HTML (contentEditable root) → markdown string for persistence. */
export function htmlToMarkdown(element: HTMLElement): string {
  let result = "";

  const processNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\u200b/g, "");
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      if (isMentionSpan(node)) {
        return getMentionToken(
          node.dataset.mentionKey ?? "",
          node.dataset.mentionSlug ?? "",
        );
      }

      if (isChannelLinkSpan(node)) {
        return getChannelLinkToken(node.dataset.channelLabel ?? "");
      }

      const htmlElement = node as HTMLElement;
      const tag = htmlElement.tagName.toLowerCase();

      if (tag === "pre") {
        const codeElement = htmlElement.querySelector("code");
        const content = getCodeContent(codeElement ?? htmlElement);
        const language = codeElement ? getCodeLanguage(codeElement) : undefined;
        return serializeFencedCode(content, language);
      }

      let content = "";
      htmlElement.childNodes.forEach((child: Node) => {
        const childMarkdown = processNode(child);
        content = appendChildMarkdown(content, child, childMarkdown);
      });

      switch (tag) {
        case "strong":
        case "b":
          return wrapInlineMarkdownMarker(content, "**", "**");
        case "em":
        case "i":
          return wrapInlineMarkdownMarker(content, "_", "_");
        case "u":
          return wrapInlineMarkdownMarker(content, "<u>", "</u>");
        case "s":
        case "strike":
        case "del":
          return wrapInlineMarkdownMarker(content, "~~", "~~");
        case "code": {
          if (content.includes("\n")) {
            return serializeFencedCode(content, getCodeLanguage(htmlElement));
          }
          return wrapInlineMarkdownMarker(content, "`", "`");
        }
        case "a":
          return `[${content}](${escapeMarkdownLinkUrl(
            htmlElement.getAttribute("href") || "",
          )})`;
        case "h1":
          return `# ${content}\n`;
        case "h2":
          return `## ${content}\n`;
        case "h3":
          return `### ${content}\n`;
        case "li":
          return `- ${content}\n`;
        case "ul": {
          const items = Array.from(htmlElement.children).filter(
            (child) => child.tagName.toLowerCase() === "li",
          );
          return items
            .map((child) => {
              let itemContent = "";
              child.childNodes.forEach((grandchild: Node) => {
                itemContent += processNode(grandchild);
              });
              return `- ${itemContent.trim()}`;
            })
            .join("\n")
            .concat("\n");
        }
        case "ol": {
          const items = Array.from(htmlElement.children).filter(
            (child) => child.tagName.toLowerCase() === "li",
          );
          return items
            .map((child, index) => {
              let itemContent = "";
              child.childNodes.forEach((grandchild: Node) => {
                itemContent += processNode(grandchild);
              });
              return `${index + 1}. ${itemContent.trim()}`;
            })
            .join("\n")
            .concat("\n");
        }
        case "blockquote":
          return serializeBlockquote(content);
        case "br":
          return "\n";
        case "div":
        case "p":
          return content.endsWith("\n") ? content : `${content}\n`;
        default:
          return content;
      }
    }

    return "";
  };

  element.childNodes.forEach((node) => {
    const nodeMarkdown = processNode(node);
    result = appendChildMarkdown(result, node, nodeMarkdown);
  });

  const normalized = result.replace(/\r/g, "");
  if (normalized.trim().length === 0) {
    return "";
  }

  return normalized;
}
