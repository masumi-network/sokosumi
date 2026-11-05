import type { ReactNode } from "react";

const HEADING = /^#{1,6}\s+/;
const BULLET = /^(?:[-*•]|\d+[.)])\s+/;

/** Markdown marks Cuso may still write ("## ", "**"), gone for previews. */
export function plainText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(HEADING, "").replace(/\*\*([^*]+)\*\*/g, "$1"))
    .join("\n")
    .trim();
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

/**
 * A finished piece as the reader sees it: headings, lists and bold rendered,
 * not shown as raw "#" and "**". A first heading that repeats the title
 * above it is left out.
 */
export function DraftText({ text, title }: { text: string; title?: string }) {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim());
  const firstLine = lines[first]?.replace(HEADING, "").trim();
  if (
    title &&
    firstLine &&
    firstLine.toLowerCase() === title.trim().toLowerCase()
  ) {
    lines.splice(first, 1);
  }
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`l${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (BULLET.test(line)) {
      list.push(line.replace(BULLET, ""));
      continue;
    }
    flush();
    if (!line) continue;
    blocks.push(
      HEADING.test(line) ? (
        <p key={blocks.length} className="draft-heading">
          {inline(line.replace(HEADING, ""))}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div className="draft-text">{blocks}</div>;
}
