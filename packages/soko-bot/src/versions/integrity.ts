import { SOKO_BOT_CAPABILITIES, type SokoBotCapability } from "../policy.js";
import { WRITING_SKILLS } from "../writing-skills/index.js";
import {
  CMO_PRODUCTION_TOOLS,
  cmoCompactProduction,
} from "./cmo-v26-skills.js";
import { applyE1Skill } from "./e1-prompts.js";
import { SKILL_INDEX, type SkillOccasion } from "./skill-index.js";
import { SOKO_BOT_SKILLS } from "./skills.js";
import type { SokoBotVersion } from "./types.js";
import { sokoBotReadsPlaybooks } from "./v39-skills.js";

/**
 * A narrower tool set some turns of a version get (cmo-v26's production run),
 * with the occasion whose skills it carries in full. The version's every-turn
 * set is always checked; these are checked on top.
 */
export interface TurnToolProfile {
  id: string;
  appliesTo: (version: SokoBotVersion) => boolean;
  occasion: SkillOccasion;
  tools: readonly SokoBotCapability[];
  /** `skill:tool` pairs a carried skill may name off this set, with why. */
  namedWithoutOffer?: Readonly<Record<string, string>>;
}

/** Profiles that narrow a version's tools on some turns; versions add theirs. */
export const TURN_TOOL_PROFILES: TurnToolProfile[] = [
  {
    id: "compact production",
    appliesTo: (version) => cmoCompactProduction(version.skills),
    occasion: "production",
    tools: CMO_PRODUCTION_TOOLS,
    // Every-turn texts in the byte-stable system prompt; a production run
    // makes the month and gets a plain refusal if it reaches for these.
    namedWithoutOffer: {
      "cmo-core-writes-strategy:write_strategy":
        "strategy changes belong to chat and strategy turns",
      "cmo-tool-highlights:save_brand_brain":
        "Brand Brain saves belong to chat and brand turns",
    },
  },
];

/**
 * Tool names a skill text may name without the turn offering them, each with
 * why. Anything else a skill names must be offered where the skill is carried.
 */
const NAMED_WITHOUT_OFFER: Readonly<Record<string, string>> = {
  // read_skill reads writing skills on these versions; the index tells the
  // model to call read_skill wherever a text says read_writing_skill.
  read_writing_skill: "alias of read_skill on skill-on-demand versions",
  // Production texts tell Cuso never to call these: Core makes the media.
  generate_image: "named only to forbid it",
  generate_video: "named only to forbid it",
  // cmo-code-tools shares Soko Bot's example script, which pages a mailbox.
  search_inbox: "named only in an example script",
  read_email: "named only in an example script",
};

const CAPABILITIES: ReadonlySet<string> = new Set(SOKO_BOT_CAPABILITIES);

/** Skill ids a text could name; one-word ids read as ordinary words. */
const NAMEABLE_SKILL_IDS: readonly string[] = [
  ...SOKO_BOT_SKILLS.map((skill) => skill.id),
  ...WRITING_SKILLS.map((skill) => skill.id),
].filter((id) => id.includes("-"));

/**
 * Skill names a text keeps although some versions cannot read them, each with
 * why. read_skill answers an unknown id with the closest ones it has.
 */
const UNREADABLE_NAME_KNOWN: Readonly<Record<string, string>> = {
  // cmo-v12 to cmo-v25 read cmo-seo-reports instead; the shared text is a
  // prompt change, handed to Neon (2026-11-27).
  "cmo-measurement:cmo-seo": "read_skill points to cmo-seo-reports",
};

/** Skills the version's own texts name that read_skill would refuse. */
function unreadableSkillNames(version: SokoBotVersion): string[] {
  const readable = new Set([
    ...version.skills,
    ...(version.profile === "cmo"
      ? WRITING_SKILLS.map((skill) => skill.id)
      : sokoBotReadsPlaybooks(version.skills)
        ? WRITING_SKILLS.filter((skill) => skill.group === "playbooks").map(
            (skill) => skill.id,
          )
        : []),
  ]);
  const texts: [string, string][] = [
    ["system prompt", version.systemPrompt],
    ...version.skills.map((id): [string, string] => {
      const raw = SOKO_BOT_SKILLS.find((skill) => skill.id === id);
      return [id, raw ? applyE1Skill(raw, version).content : ""];
    }),
  ];
  const problems: string[] = [];
  for (const [where, text] of texts)
    for (const id of NAMEABLE_SKILL_IDS)
      if (
        !readable.has(id) &&
        !(`${where}:${id}` in UNREADABLE_NAME_KNOWN) &&
        new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text)
      )
        problems.push(`${where} names skill ${id}, not in this version`);
  return problems;
}

/** The tool names a skill text mentions. */
function namedTools(content: string): string[] {
  return [
    ...new Set(
      (content.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((word) =>
        CAPABILITIES.has(word),
      ),
    ),
  ];
}

/** What a set of skills needs that `tools` does not offer. */
function missingTools(
  label: string,
  skills: readonly string[],
  tools: ReadonlySet<string>,
  scanNames: boolean,
  version: Pick<SokoBotVersion, "e1Prompts"> & {
    skillsOnDemand?: boolean;
    skills?: readonly string[];
  },
  allowed: Readonly<Record<string, string>> = {},
): string[] {
  const problems: string[] = [];
  for (const id of skills) {
    for (const tool of SKILL_INDEX[id]?.requiresTools ?? [])
      if (!tools.has(tool))
        problems.push(`${label}: ${id} requires ${tool}, not offered`);
    if (!scanNames) continue;
    const raw = SOKO_BOT_SKILLS.find((skill) => skill.id === id);
    const content = raw ? applyE1Skill(raw, version).content : undefined;
    for (const tool of namedTools(content ?? ""))
      if (
        !tools.has(tool) &&
        !(tool in NAMED_WITHOUT_OFFER) &&
        !(`${id}:${tool}` in allowed)
      )
        problems.push(`${label}: ${id} names ${tool}, not offered`);
  }
  return problems;
}

/** The skills a turn of `occasion` carries in full. */
function carriedOn(version: SokoBotVersion, occasion: SkillOccasion): string[] {
  return version.skills.filter((id) => {
    const preloadOn = SKILL_INDEX[id]?.preloadOn ?? [];
    return preloadOn.includes("always") || preloadOn.includes(occasion);
  });
}

/**
 * Everything wrong with how a version is put together: a skill that does
 * not exist or is listed twice, a skill-on-demand version's skill without an
 * index line, and a tool a carried skill needs or names that its turn does
 * not offer. Empty when the version is whole.
 */
export function versionIntegrityProblems(
  version: SokoBotVersion,
  everyTurnTools: readonly SokoBotCapability[],
  profiles: readonly TurnToolProfile[] = TURN_TOOL_PROFILES,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of version.skills) {
    if (seen.has(id)) problems.push(`${id} is listed twice`);
    seen.add(id);
    if (!SOKO_BOT_SKILLS.some((skill) => skill.id === id))
      problems.push(`${id} is not a skill`);
  }
  problems.push(...unreadableSkillNames(version));
  const onDemand = version.skillsOnDemand === true;
  problems.push(
    ...missingTools(
      "every turn",
      version.skills,
      new Set(everyTurnTools),
      onDemand,
      version,
    ),
  );
  const applied = profiles.filter((each) => each.appliesTo(version));
  if (!onDemand) {
    // Every skill is in the system prompt, so every profile needs them all.
    for (const profile of applied)
      problems.push(
        ...missingTools(
          profile.id,
          version.skills,
          new Set(profile.tools),
          false,
          version,
        ),
      );
    return problems;
  }
  for (const id of version.skills)
    if (!SKILL_INDEX[id]?.useWhen) problems.push(`${id} has no index line`);
  for (const [label, tools] of [
    ["every turn", everyTurnTools] as const,
    ...applied.map((profile) => [profile.id, profile.tools] as const),
  ])
    if (!tools.includes("read_skill"))
      problems.push(
        `${label}: read_skill not offered, the index cannot be read`,
      );
  for (const profile of applied)
    problems.push(
      ...missingTools(
        profile.id,
        carriedOn(version, profile.occasion),
        new Set(profile.tools),
        true,
        version,
        profile.namedWithoutOffer,
      ),
    );
  return problems;
}
