import remarkParse from "remark-parse";
import { unified } from "unified";

interface MarkdownNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

interface HtmlNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  position?: { start: { offset?: number } };
}

interface MermaidSource {
  raw: string;
  source: string;
  complete: boolean;
  overLimit: boolean;
}

/** Protect original spans, then identify them by their restored display offset. */
export function prepareMermaidMarkdown({
  source,
  highlightTerm = "",
  transform,
}: {
  source: string;
  highlightTerm?: string;
  transform: (markdown: string) => string;
}) {
  const tokens = new Map<string, MermaidSource>();
  const displaySource = transform(source);
  // Sanitization can decode character references. Reserve the transformed text
  // too, so an entity in untrusted prose cannot impersonate a protected span.
  const reserved = source + displaySource + highlightTerm;
  let tokenPoint = 0xe000;
  let cursor = 0;
  let protectedSource = "";
  function collect(node: MarkdownNode) {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = source.slice(start, end);
      // Search must not highlight the placeholder itself.
      while (reserved.includes(String.fromCodePoint(tokenPoint))) tokenPoint++;
      const token = String.fromCodePoint(tokenPoint++);
      protectedSource += source.slice(cursor, start) + token;
      cursor = end;
      const fence = raw.match(/^(`{3,}|~{3,})/)?.[1];
      const lastLine =
        raw
          .split(/\r?\n/)
          .at(-1)
          ?.replace(/^(?:[ \t]*>[ \t]?)+/, "")
          .trim() ?? "";
      tokens.set(token, {
        raw,
        source: node.value ?? "",
        overLimit: tokens.size >= 8,
        complete: Boolean(
          fence &&
            lastLine.length >= fence.length &&
            [...lastLine].every((char) => char === fence[0]) &&
            raw.includes("\n"),
        ),
      });
    }
    node.children?.forEach(collect);
  }
  collect(unified().use(remarkParse).parse(source));
  protectedSource += source.slice(cursor);
  const blocks = new Map<number, MermaidSource>();
  let delta = 0;
  const transformed = tokens.size ? transform(protectedSource) : displaySource;
  const markdown = tokens.size
    ? transformed.replace(
        new RegExp([...tokens.keys()].join("|"), "gu"),
        (token: string, offset: number) => {
          const block = tokens.get(token)!;
          blocks.set(offset + delta, block);
          delta += block.raw.length - token.length;
          return block.raw;
        },
      )
    : transformed;
  function rehypeMermaid() {
    return (tree: HtmlNode) => {
      function visit(node: HtmlNode) {
        const offset = node.position?.start.offset;
        if (node.tagName === "pre" && offset !== undefined) {
          const block = blocks.get(offset);
          if (block)
            node.properties = {
              ...node.properties,
              "data-mermaid-source": block.source,
              "data-mermaid-complete": block.complete,
              "data-mermaid-limit": block.overLimit,
            };
        }
        node.children?.forEach(visit);
      }
      visit(tree);
    };
  }
  return { markdown, rehypeMermaid };
}
