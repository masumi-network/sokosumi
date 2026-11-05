export interface SokoBotBriefSection {
  title: string;
  body: string;
}

/** A check-in written in the brief shape the bot's rhythm prompts ask for. */
export interface SokoBotBrief {
  headline: string;
  sections: SokoBotBriefSection[];
  numbers: string[];
  /** What Core put above the bot's words: receipts and file links. */
  notes: string;
}

const SECTION_HEADING = /^#{2,4}\s+(.+?)\s*:?\s*$/;
const NUMBERS_LINE = /^numbers:\s*(.+)$/i;

/**
 * Reads a check-in as headline, headed sections and a numbers line; null
 * when the text does not have that shape, so it renders as a plain message.
 */
export function parseSokoBotBrief(content: string): SokoBotBrief | null {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
  const first = lines.findIndex((line) => SECTION_HEADING.test(line));
  if (first < 1) return null;
  const paragraphs = lines
    .slice(0, first)
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const headline = paragraphs.pop();
  if (!headline || headline.includes("\n")) return null;

  const sections: SokoBotBriefSection[] = [];
  let numbers: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const close = () => {
    const body = current?.lines.join("\n").trim();
    if (current && body) sections.push({ title: current.title, body });
  };
  for (const line of lines.slice(first)) {
    const heading = SECTION_HEADING.exec(line);
    const counts = NUMBERS_LINE.exec(line.trim());
    if (heading) {
      close();
      current = { title: heading[1], lines: [] };
    } else if (counts) {
      numbers = counts[1]
        .split(/\s+·\s+/)
        .map((item) => item.trim().replace(/\.$/, ""))
        .filter(Boolean);
    } else current?.lines.push(line);
  }
  close();
  if (sections.length === 0) return null;
  return { headline, sections, numbers, notes: paragraphs.join("\n\n") };
}
