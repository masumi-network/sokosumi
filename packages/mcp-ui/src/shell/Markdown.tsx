import type { ReactNode } from "react";
import { isUnderBase } from "./text.ts";

/**
 * Record text as Markdown, the subset Web's descriptions use (GFM with
 * single line breaks kept): headings, paragraphs, lists and task lists,
 * quotes, code, rules, tables, strong, emphasis, strikethrough and links.
 *
 * It builds React elements and nothing else, so raw HTML stays text (ADR
 * 0083). A link opens only under `webBaseUrl`; any other link, and every
 * image, shows as its text. A parser library would cost 55 to 80 KB of the
 * 600 KB a view may weigh.
 */
export function Markdown({
  text,
  webBaseUrl,
  onOpenLink,
}: {
  text: string;
  webBaseUrl?: string;
  onOpenLink: (url: string) => void;
}) {
  const link: LinkRenderer = (href, children, key) =>
    isUnderBase(href, webBaseUrl) ? (
      <a
        key={key}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onOpenLink(href);
        }}
        className="focus-visible:outline-ring rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2"
      >
        {children}
      </a>
    ) : (
      <span key={key}>{children}</span>
    );
  return (
    <div className="text-sm leading-relaxed wrap-anywhere [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      {renderBlocks(parseBlocks(text.split(/\r?\n/)), link)}
    </div>
  );
}

type LinkRenderer = (
  href: string,
  children: ReactNode,
  key: number,
) => ReactNode;

type Block =
  | { type: "heading"; depth: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "quote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Item[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "rule" };
type Item = { checked?: boolean; children: Block[] };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function startsBlock(line: string): boolean {
  return [FENCE, HEADING, RULE, QUOTE, LIST_ITEM].some((rule) =>
    rule.test(line),
  );
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        body.push(lines[i++]);
      }
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1].length,
        text: heading[2] ?? "",
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i++].replace(QUOTE, ""));
      }
      blocks.push({ type: "quote", children: parseBlocks(body) });
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const marker = first[2].slice(-1);
      const items: Item[] = [];
      while (i < lines.length) {
        // Blank lines between items keep one (loose) list.
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        const item = LIST_ITEM.exec(lines[next] ?? "");
        if (
          !item ||
          /\d/.test(item[2]) !== ordered ||
          item[2].slice(-1) !== marker
        ) {
          break;
        }
        i = next;
        // Lines indented past the marker belong to the item, as do lazy
        // lines that continue its text.
        const indent = item[1].length + item[2].length + 1;
        const body = [item[3] ?? ""];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          const leading = next.length - next.trimStart().length;
          // A list marker indented past this item's marker nests in it.
          const nested =
            (LIST_ITEM.exec(next)?.[1].length ?? -1) > item[1].length;
          const indented = leading >= indent || nested;
          const lazy = next.trim() && body.at(-1)?.trim() && !startsBlock(next);
          if (next.trim() && !indented && !lazy) break;
          if (!next.trim() && !lines[i + 1]?.startsWith(" ".repeat(indent)))
            break;
          body.push(
            indented ? next.slice(Math.min(leading, indent)) : next.trim(),
          );
          i++;
        }
        const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
        if (task) body[0] = body[0].slice(task[0].length);
        items.push({
          checked: task ? task[1] !== " " : undefined,
          children: parseBlocks(body),
        });
      }
      blocks.push({
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(first[2], 10) : 1,
        items,
      });
      continue;
    }

    if (line.includes("|") && TABLE_DELIMITER.test(lines[i + 1] ?? "")) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i++]));
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const body = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      body.push(lines[i++].trim());
    }
    blocks.push({ type: "paragraph", text: body.join("\n") });
  }
  return blocks;
}

const HEADING_CLASS = [
  "",
  "text-lg",
  "text-base",
  "text-sm",
  "text-sm",
  "text-sm",
  "text-sm",
];

function renderBlocks(blocks: Block[], link: LinkRenderer): ReactNode[] {
  return blocks.map((block, key) => {
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.depth}` as "h1";
        return (
          <Tag
            key={key}
            className={`mt-4 mb-2 font-semibold tracking-tight ${HEADING_CLASS[block.depth]}`}
          >
            {renderInline(block.text, link)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={key} className="my-2">
            {renderInline(block.text, link)}
          </p>
        );
      case "code":
        return (
          <pre
            key={key}
            className="bg-card-background my-3 max-w-full overflow-x-auto rounded-md border px-4 py-3 font-mono text-xs leading-6"
          >
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote
            key={key}
            className="border-input text-muted-foreground my-3 border-l-2 pl-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
          >
            {renderBlocks(block.children, link)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} className="my-4" />;
      case "table":
        return (
          <div key={key} className="my-3 overflow-x-auto rounded-md border">
            <table className="w-full text-left">
              <thead className="border-b">
                <tr>
                  {block.header.map((cell, index) => (
                    <th
                      key={index}
                      className="bg-card-background px-3 py-2 font-medium"
                    >
                      {renderInline(cell, link)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    {row.map((cell, column) => (
                      <td key={column} className="px-3 py-2 align-top">
                        {renderInline(cell, link)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag
            key={key}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
            className={`my-2 ps-6 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}
          >
            {block.items.map((item, index) => (
              <li
                key={index}
                className={`my-1 ps-1 [&>p]:my-0 [&>ul]:my-1 [&>ol]:my-1 ${item.checked === undefined ? "" : "-ms-5 list-none"}`}
              >
                {item.checked !== undefined && (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled
                    readOnly
                    className="accent-foreground me-2 align-middle"
                  />
                )}
                {item.children.length === 1 &&
                item.children[0].type === "paragraph"
                  ? renderInline(item.children[0].text, link)
                  : renderBlocks(item.children, link)}
              </li>
            ))}
          </Tag>
        );
      }
    }
  });
}

/** The inline rules, tried in order at each position. */
const INLINE: [
  RegExp,
  (match: RegExpExecArray, link: LinkRenderer, key: number) => ReactNode,
][] = [
  [/^\\([!-/:-@[-`{-~])/, (m) => m[1]],
  [
    /^(`+)([\s\S]*?[^`])\1(?!`)/,
    (m, _link, key) => (
      <code
        key={key}
        className="bg-muted rounded px-1 py-0.5 font-mono text-xs wrap-break-word"
      >
        {m[2].trim()}
      </code>
    ),
  ],
  // An image shows its alt text: views load nothing remote.
  [/^!\[([^\]]*)\]\([^)]*\)/, (m) => m[1]],
  [
    /^\[([^\]]+)\]\(<?([^)\s>]*)>?(?:\s+"[^"]*")?\)/,
    (m, link, key) => link(m[2], renderInline(m[1], link), key),
  ],
  [/^<(https?:\/\/[^>\s]+)>/, (m, link, key) => link(m[1], m[1], key)],
  [
    /^https?:\/\/[^\s<]*[^\s<.,:;"')\]!?*_~]/,
    (m, link, key) => link(m[0], m[0], key),
  ],
  [
    /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/,
    (m, link, key) => (
      <strong key={key} className="font-bold">
        {renderInline(m[2], link)}
      </strong>
    ),
  ],
  [
    /^~~(?=\S)([\s\S]*?\S)~~/,
    (m, link, key) => <del key={key}>{renderInline(m[1], link)}</del>,
  ],
  [
    /^([*_])(?=\S)([\s\S]*?[^\s*_])\1(?![*_\w])/,
    (m, link, key) => <em key={key}>{renderInline(m[2], link)}</em>,
  ],
  [/^\n/, (_m, _link, key) => <br key={key} />],
];

function renderInline(text: string, link: LinkRenderer): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    // `_` and a bare URL start only at a word's start.
    const wordStart = i === 0 || !/\w/.test(text[i - 1]);
    const rule = INLINE.find(
      ([pattern]) => (wordStart || !/^[_h]/.test(rest)) && pattern.test(rest),
    );
    if (!rule) {
      plain += text[i++];
      continue;
    }
    const match = rule[0].exec(rest) as RegExpExecArray;
    const node = rule[1](match, link, nodes.length);
    if (typeof node === "string") {
      plain += node;
    } else {
      if (plain) nodes.push(plain);
      plain = "";
      nodes.push(node);
    }
    i += match[0].length;
  }
  if (plain) nodes.push(plain);
  return nodes;
}
