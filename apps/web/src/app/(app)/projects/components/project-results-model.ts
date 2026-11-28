import { escapeMarkdownDisplayText } from "@/lib/utils/mention-parser";

interface ResultEvent {
  status?: string | null;
  comment?: string | null;
  createdAt: Date | string;
}

/** A Task's result is its newest done comment, as the Task page shows it. */
export function latestResult(
  events: readonly ResultEvent[],
): { comment: string; createdAt: string } | null {
  let latest: { comment: string; at: number } | null = null;
  for (const { status, comment, createdAt } of events) {
    if (status !== "COMPLETED" || !comment?.trim()) continue;
    const at = new Date(createdAt).getTime();
    if (!latest || at >= latest.at) latest = { comment, at };
  }
  return latest
    ? { comment: latest.comment, createdAt: new Date(latest.at).toISOString() }
    : null;
}

export interface ProjectResultSection {
  heading: string;
  meta: string;
  link: { label: string; url: string };
  body: string;
}

/** Each `#` heading two levels deeper, so a result's own titles sit under its Task. Fenced code stays as written. */
function nestHeadings(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && (!fence || marker.startsWith(fence))) {
        fence = fence ? null : marker;
        return line;
      }
      if (fence) return line;
      return line.replace(/^(#{1,4})(?=\s)/, "$1##");
    })
    .join("\n");
}

/** One document: the title, then each result under a heading that names its Task. */
export function projectResultsMarkdown({
  title,
  sections,
}: {
  title: string;
  sections: readonly ProjectResultSection[];
}): string {
  const parts = [`# ${escapeMarkdownDisplayText(title)}`];
  for (const { heading, meta, link, body } of sections) {
    parts.push(
      `## ${escapeMarkdownDisplayText(heading)}`,
      `${escapeMarkdownDisplayText(meta)} · [${escapeMarkdownDisplayText(link.label)}](${link.url})`,
      nestHeadings(body.trim()),
    );
  }
  return `${parts.join("\n\n")}\n`;
}
