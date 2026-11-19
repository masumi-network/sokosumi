import type { ReactNode } from "react";

const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;

/** A Markdown table row's cells, without the outer pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

type Block =
  | { kind: "text"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

/**
 * A message as text and tables. A table is a header row, a rule row
 * ("|---|---|") and its rows; anything else stays text as written.
 */
export function messageBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let text: string[] = [];
  const flush = () => {
    const joined = text.join("\n").trim();
    if (joined) blocks.push({ kind: "text", text: joined });
    text = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const rule = lines[index + 1] ?? "";
    if (!ROW.test(line) || !RULE.test(rule)) {
      text.push(line);
      continue;
    }
    flush();
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && ROW.test(lines[index] ?? "")) {
      rows.push(cells(lines[index] ?? ""));
      index++;
    }
    index--;
    blocks.push({ kind: "table", head: cells(line), rows });
  }
  flush();
  return blocks;
}

/**
 * What Cuso wrote, as the owner reads it: his words, and a table where he
 * wrote one, instead of rows of pipes and dashes.
 */
export function MessageText({
  content,
  inline,
}: {
  content: string;
  /** Bold and links inside a line or a cell. */
  inline: (text: string) => ReactNode[];
}) {
  return messageBlocks(content).map((block, index) =>
    block.kind === "text" ? (
      <p key={index} className="txt">
        {inline(block.text)}
      </p>
    ) : (
      <div key={index} className="seo-table-wrap chat-table">
        <table className="seo-table">
          <thead>
            <tr>
              {block.head.map((cell, column) => (
                <th key={column} scope="col">
                  {inline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, line) => (
              <tr key={line}>
                {block.head.map((_, column) => (
                  <td key={column}>{inline(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  );
}
