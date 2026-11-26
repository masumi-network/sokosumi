export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_BRIEFING_MAX_LENGTH = 20_000;
export const BRIEFING_WORD_TARGET = 300;

export const BRIEFING_CHIP_IDS = [
  "goals",
  "audience",
  "channels",
  "timeline",
  "tone",
  "kpis",
  "mustHaves",
  "mustAvoids",
] as const;

export type BriefingChipId = (typeof BRIEFING_CHIP_IDS)[number];

export function countBriefingWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}

export function insertBriefingHeading(value: string, heading: string): string {
  const marker = `## ${heading}`;
  const alreadyPresent = value
    .split(/\r\n|\r|\n/)
    .some((line) => line.trim() === marker);
  if (alreadyPresent) {
    return value;
  }

  const trimmed = value.trimEnd();
  if (!trimmed) {
    return `${marker}\n`;
  }

  return `${trimmed}\n\n${marker}\n`;
}

export interface BriefingCopySource {
  id: string;
  name: string;
  briefing: string;
}

/** Other projects whose briefing can seed this one, sorted by name. */
export function briefingCopySources(
  projects: { id: string; name: string; briefing?: string | null }[],
  currentProjectId: string,
): BriefingCopySource[] {
  return projects
    .flatMap(({ id, name, briefing }) =>
      id !== currentProjectId && briefing?.trim()
        ? [{ id, name, briefing }]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
