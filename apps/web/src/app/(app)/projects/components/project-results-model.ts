import { escapeMarkdownDisplayText } from "@/lib/utils/mention-parser";

type ResultActor =
  | { type: "user"; user: { name: string } }
  | { type: "coworker"; coworker: { name: string } }
  | { type: "sokoBot"; sokoBot: { name: string | null } };

interface ResultEvent {
  status?: string | null;
  comment?: string | null;
  createdAt: Date | string;
  actor?: ResultActor | null;
}

function actorName(actor: ResultActor | null | undefined): string | null {
  if (!actor) return null;
  if (actor.type === "user") return actor.user.name;
  if (actor.type === "coworker") return actor.coworker.name;
  return actor.sokoBot.name;
}

/** A Task's result is its newest done comment, as the Task page shows it, and who wrote it. */
export function latestResult(
  events: readonly ResultEvent[],
): { comment: string; createdAt: string; by: string | null } | null {
  let latest: ResultEvent | null = null;
  for (const event of events) {
    if (event.status !== "COMPLETED" || !event.comment?.trim()) continue;
    if (
      !latest ||
      new Date(event.createdAt).getTime() >=
        new Date(latest.createdAt).getTime()
    )
      latest = event;
  }
  return latest?.comment
    ? {
        comment: latest.comment,
        createdAt: new Date(latest.createdAt).toISOString(),
        by: actorName(latest.actor),
      }
    : null;
}

export interface ProjectResultSection {
  heading: string;
  meta: string;
  link: { label: string; url: string };
  body: string;
}

// CommonMark fences: up to three spaces of indent; a backtick opener's info
// string has no backtick; a closer repeats the character at least as many
// times and has nothing but spaces after it.
const FENCE_OPENER = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Each `#` heading two levels deeper, so a result's own titles sit under its
 * Task. Fenced code stays as written, and a block the result left open is
 * closed, so it cannot swallow the next Task.
 */
function nestHeadings(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      if (fence) {
        const closer = FENCE_CLOSER.exec(line)?.[1];
        if (closer?.[0] === fence[0] && closer.length >= fence.length)
          fence = null;
        return line;
      }
      fence = FENCE_OPENER.exec(line)?.[1] ?? null;
      if (fence) return line;
      return line.replace(/^(#{1,4})(?=\s)/, "$1##");
    })
    .concat(fence ? [fence] : [])
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
