import type {
  FundraisingProspect,
  FundraisingStage,
} from "@sokosumi/core-client";

/** The pipeline's order; Passed last. */
export const FUNDRAISING_STAGES = [
  "TO_RESEARCH",
  "WARM_PATH",
  "REACHED_OUT",
  "MEETING",
  "DATA_ROOM",
  "DILIGENCE",
  "COMMITTED",
  "PASSED",
] as const satisfies readonly FundraisingStage[];

/** Investors as the board shows them: by stage, the latest touch first, then by name. */
export function sortProspects(
  prospects: FundraisingProspect[],
): FundraisingProspect[] {
  const order = (stage: FundraisingStage) => FUNDRAISING_STAGES.indexOf(stage);
  const touch = (prospect: FundraisingProspect) =>
    prospect.contact.lastContactAt
      ? new Date(prospect.contact.lastContactAt).getTime()
      : 0;
  return [...prospects].sort(
    (a, b) =>
      order(a.stage) - order(b.stage) ||
      touch(b) - touch(a) ||
      a.contact.name.localeCompare(b.contact.name),
  );
}

export function countByStage(
  prospects: FundraisingProspect[],
): Record<FundraisingStage, number> {
  const counts = Object.fromEntries(
    FUNDRAISING_STAGES.map((stage) => [stage, 0]),
  ) as Record<FundraisingStage, number>;
  for (const prospect of prospects) counts[prospect.stage] += 1;
  return counts;
}

/** A whole-dollar amount from what someone typed: "1.5m", "250k", "$1,000,000". */
export function parseUsd(text: string): number | null | undefined {
  const trimmed = text
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "");
  if (trimmed === "") return null;
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(trimmed);
  if (!match?.[1]) return undefined;
  const factor = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.round(Number(match[1]) * factor);
}
