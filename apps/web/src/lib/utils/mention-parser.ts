export const MENTION_MATCH_REGEX = /@([^\s:]+)(?::([^\s]+))?/g;

export interface MentionMatch {
  id: string;
  slug: string;
  start: number;
  end: number;
  hasLegacyFormat: boolean;
}

export function slugifyMentionValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-+/g, "-");
}

export function parseMentions(text: string): MentionMatch[] {
  const matches: MentionMatch[] = [];
  MENTION_MATCH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_MATCH_REGEX.exec(text))) {
    const rawValue = match[1] ?? "";
    const hasLegacyFormat = Boolean(match[2]);
    const rawSlug = match[2] ?? "";
    const slug = hasLegacyFormat ? rawSlug : slugifyMentionValue(rawValue);

    matches.push({
      id: rawValue,
      slug,
      start: match.index,
      end: match.index + match[0].length,
      hasLegacyFormat,
    });
  }

  return matches;
}

export function formatMentionsAsMarkdownLinks(
  text: string,
  agentNameById: Map<string, string>,
): string {
  const matches = parseMentions(text);
  if (matches.length === 0) {
    return text;
  }

  let formatted = "";
  let lastIndex = 0;

  for (const match of matches) {
    if (match.start > lastIndex) {
      formatted += text.slice(lastIndex, match.start);
    }

    const agentName = agentNameById.get(match.id);
    if (agentName) {
      formatted += `[@${agentName}](/agents/${match.id}/jobs)`;
    } else {
      formatted += text.slice(match.start, match.end);
    }

    lastIndex = match.end;
  }

  if (lastIndex < text.length) {
    formatted += text.slice(lastIndex);
  }

  return formatted;
}
