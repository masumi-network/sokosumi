import type {
  FundraisingConnector,
  FundraisingPath,
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

/** Who to ask for the intro along a path: the contact it runs through, or the teammate who knows them. */
export function pathConnector(
  path: FundraisingPath,
  meId: string | null,
): FundraisingConnector | null {
  if (path.through)
    return {
      kind: "contact",
      id: path.through.id,
      name: path.through.name,
      image: path.through.avatarUrl,
      email: path.through.email,
    };
  if (path.via && path.via.id !== meId)
    return {
      kind: "teammate",
      id: path.via.id,
      name: path.via.name,
      image: path.via.image,
      email: null,
    };
  return null;
}

export type IntroAction =
  | { kind: "asked"; via: FundraisingConnector; at: Date }
  | { kind: "made"; via: FundraisingConnector; at: Date }
  | {
      kind: "ask";
      path: FundraisingPath;
      connector: FundraisingConnector;
      /** The teammate who holds the tie, when it is not the viewer. */
      viaName: string | null;
      declined: FundraisingConnector | null;
    }
  | { kind: "write"; path: FundraisingPath }
  | { kind: "none"; declined: FundraisingConnector | null };

/** The one next action an investor row shows: the intro in flight, else the best path to ask along, else nothing. */
export function introAction(
  prospect: FundraisingProspect,
  meId: string | null,
): IntroAction {
  const { intro, bestPath } = prospect;
  if (intro.via && intro.madeAt && !intro.declinedAt)
    return { kind: "made", via: intro.via, at: intro.madeAt };
  if (intro.via && intro.askedAt && !intro.declinedAt)
    return { kind: "asked", via: intro.via, at: intro.askedAt };
  const declined = intro.declinedAt ? intro.via : null;
  if (!bestPath) return { kind: "none", declined };
  const connector = pathConnector(bestPath, meId);
  if (!connector) return { kind: "write", path: bestPath };
  if (declined && declined.id === connector.id)
    return { kind: "none", declined };
  return {
    kind: "ask",
    path: bestPath,
    connector,
    viaName:
      bestPath.through && bestPath.via && bestPath.via.id !== meId
        ? bestPath.via.name
        : null,
    declined,
  };
}
