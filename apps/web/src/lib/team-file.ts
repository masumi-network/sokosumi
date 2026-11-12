import { z } from "zod";

import { CAP_TABLE_FILE_SUFFIX } from "@/lib/cap-table-file";

/**
 * A team file: people, their roles and who reports to whom, as JSON named
 * `*.team.json`. Drive and data rooms render it as an org chart with a
 * profile per person instead of raw JSON; a file of one person is that
 * person's profile page.
 *
 * Photos are inline `data:image/…` URIs only, so opening the file never
 * fetches from another host (a data room viewer's address stays private).
 */
const TEAM_FILE_SUFFIX = ".team.json";

const entrySchema = z.object({
  title: z.string().min(1),
  place: z.string().optional(),
  when: z.string().optional(),
});

const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  photo: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  linkedin: z
    .url({ protocol: /^https$/, hostname: /(^|\.)linkedin\.com$/ })
    .optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).default([]),
  experience: z.array(entrySchema).default([]),
  education: z.array(entrySchema).default([]),
  /** The `id` of the person this one reports to. */
  reportsTo: z.string().optional(),
  advisor: z.boolean().default(false),
});

const teamSchema = z.object({
  kind: z.literal("sokosumi.team"),
  version: z.literal(1),
  title: z.string().optional(),
  intro: z.string().optional(),
  people: z.array(personSchema).min(1),
});

export type TeamPerson = z.infer<typeof personSchema>;
export type Team = z.infer<typeof teamSchema>;

export function isTeamFileName(name: string): boolean {
  return name.toLowerCase().endsWith(TEAM_FILE_SUFFIX);
}

/**
 * "Team.team.json" reads as "Team", and "Cap table.captable.json" as
 * "Cap table", wherever a file name is shown.
 */
export function fileTitle(name: string): string {
  const suffix = [TEAM_FILE_SUFFIX, CAP_TABLE_FILE_SUFFIX].find((end) =>
    name.toLowerCase().endsWith(end),
  );
  return suffix ? name.slice(0, -suffix.length) : name;
}

export function parseTeam(json: unknown): Team | null {
  const parsed = teamSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface TeamNode {
  person: TeamPerson;
  reports: TeamNode[];
}

/**
 * The org chart: everyone who reports to nobody on the team is a root.
 * A `reportsTo` naming someone absent, or a loop, makes that person a root
 * rather than dropping them.
 */
export function teamTree(team: Team): {
  roots: TeamNode[];
  advisors: TeamPerson[];
} {
  const members = team.people.filter((person) => !person.advisor);
  const ids = new Set(members.map((person) => person.id));
  const placed = new Set<string>();

  const node = (person: TeamPerson): TeamNode => {
    placed.add(person.id);
    return {
      person,
      reports: members
        .filter(
          (other) => other.reportsTo === person.id && !placed.has(other.id),
        )
        .map(node),
    };
  };

  const roots = members
    .filter((person) => !person.reportsTo || !ids.has(person.reportsTo))
    .map(node);
  for (const person of members)
    if (!placed.has(person.id)) roots.push(node(person));

  return {
    roots,
    advisors: team.people.filter((person) => person.advisor),
  };
}
