import {
  CUSO_IDENTITY,
  composeCusoPersona,
  cusoToolDescription,
} from "../cmo-texts.js";
import { composeSokoBotPersona, type SokoBotPersona } from "../persona.js";
import {
  isSokoBotCmoCapability,
  isSokoBotCmoReadCapability,
  isSokoBotCompetitorCapability,
  SOKO_BOT_CMO_CAPABILITIES,
  SOKO_BOT_COMPETITOR_CAPABILITIES,
  type SokoBotCapability,
} from "../policy.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import { CMO_MODEL_TRIALS } from "./cmo-model-trials.js";
import { cmoWritesMonthAtOnce } from "./cmo-skills.js";
import { cmoV1 } from "./cmo-v1.js";
import { cmoV2 } from "./cmo-v2.js";
import { cmoV3 } from "./cmo-v3.js";
import { cmoV4 } from "./cmo-v4.js";
import { cmoV5 } from "./cmo-v5.js";
import { cmoV6 } from "./cmo-v6.js";
import { cmoV7 } from "./cmo-v7.js";
import { cmoV8 } from "./cmo-v8.js";
import { cmoV9 } from "./cmo-v9.js";
import { cmoV10 } from "./cmo-v10.js";
import { cmoV11 } from "./cmo-v11.js";
import { cmoV12 } from "./cmo-v12.js";
import { cmoV13 } from "./cmo-v13.js";
import { cmoV14 } from "./cmo-v14.js";
import { cmoV15 } from "./cmo-v15.js";
import { cmoV20 } from "./cmo-v20.js";
import { cmoTurnSkills } from "./cmo-v20-skills.js";
import { cmoV21 } from "./cmo-v21.js";
import { cmoV22 } from "./cmo-v22.js";
import { cmoV23 } from "./cmo-v23.js";
import { cmoReadsOnDemand } from "./cmo-v23-skills.js";
import { cmoV24 } from "./cmo-v24.js";
import { cmoV25 } from "./cmo-v25.js";
import { cmoWritesStrategyStep } from "./cmo-v25-skills.js";
import { cmoV26 } from "./cmo-v26.js";
import { cmoV27 } from "./cmo-v27.js";
import { readsContextOnDemand } from "./context-on-demand-skills.js";
import {
  applyE1Skill,
  applyE1SystemPrompt,
  E1_SKILL_USE_WHEN_OVERRIDES,
} from "./e1-prompts.js";
import {
  applyRouteSteeringPrompt,
  ROUTE_STEERING_ACT_OR_ASK_SECTION,
} from "./route-steering.js";
import {
  skillIndexSection,
  splitSkillsForTurn,
  turnSkillsSection,
} from "./skill-index.js";
import {
  getSokoBotSkill,
  SOKO_BOT_SKILLS,
  type SokoBotSkill,
} from "./skills.js";
import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";
import { v2 } from "./v2.js";
import { v3 } from "./v3.js";
import { v4 } from "./v4.js";
import { v5 } from "./v5.js";
import { v6 } from "./v6.js";
import { v7 } from "./v7.js";
import { v8 } from "./v8.js";
import { v9 } from "./v9.js";
import { v10 } from "./v10.js";
import { v11 } from "./v11.js";
import { v12 } from "./v12.js";
import { v13 } from "./v13.js";
import { v14 } from "./v14.js";
import { v15 } from "./v15.js";
import { v16 } from "./v16.js";
import { v17 } from "./v17.js";
import { v18 } from "./v18.js";
import { v19 } from "./v19.js";
import { v20 } from "./v20.js";
import { v21 } from "./v21.js";
import { v22 } from "./v22.js";
import { v23 } from "./v23.js";
import { v24 } from "./v24.js";
import { v25 } from "./v25.js";
import { v26 } from "./v26.js";
import { v27 } from "./v27.js";
import { v28 } from "./v28.js";
import { v29 } from "./v29.js";
import { v30 } from "./v30.js";
import { v31 } from "./v31.js";
import { v32 } from "./v32.js";
import { v33 } from "./v33.js";
import { v34 } from "./v34.js";
import { v35 } from "./v35.js";
import { v36 } from "./v36.js";
import { v37 } from "./v37.js";
import { v38 } from "./v38.js";
import { v39 } from "./v39.js";
import { v40 } from "./v40.js";

/** Newest last. To iterate, add `vN.ts` and append it here. */
export const SOKO_BOT_VERSIONS: readonly SokoBotVersion[] = [
  v1,
  v2,
  v3,
  v4,
  v5,
  v6,
  v7,
  v8,
  v9,
  v10,
  v11,
  v12,
  v13,
  v14,
  v15,
  v16,
  v17,
  v18,
  v19,
  v20,
  v21,
  v22,
  v23,
  v24,
  v25,
  v26,
  v27,
  v28,
  v29,
  v30,
  v31,
  v32,
  v33,
  v34,
  v35,
  v36,
  v37,
  v38,
  v39,
  v40,
];
export const DEFAULT_SOKO_BOT_VERSION_ID = "v34";

/**
 * Versions of other products built on Soko Bots (CMO's Cuso). Kept out of
 * `SOKO_BOT_VERSIONS` so the personal-assistant fleet can never be promoted
 * or migrated onto them; a bot is pinned to one at creation.
 */
export const SOKO_BOT_PRODUCT_VERSIONS: readonly SokoBotVersion[] = [
  cmoV1,
  cmoV2,
  cmoV3,
  cmoV4,
  cmoV5,
  cmoV6,
  cmoV7,
  cmoV8,
  cmoV9,
  cmoV10,
  cmoV11,
  cmoV12,
  cmoV13,
  cmoV14,
  cmoV15,
  cmoV20,
  cmoV21,
  cmoV22,
  cmoV23,
  cmoV24,
  cmoV25,
  cmoV26,
  cmoV27,
  ...CMO_MODEL_TRIALS,
];
/** The Cuso version a new hire starts on. */
export const CMO_SOKO_BOT_VERSION_ID = cmoV23.id;
/**
 * Every Cuso version. A Cuso stays on the version he was hired on until he is
 * moved, so finding one means any of these, never only the newest.
 */
export const CMO_SOKO_BOT_VERSION_IDS: readonly string[] =
  SOKO_BOT_PRODUCT_VERSIONS.filter((version) => version.profile === "cmo").map(
    (version) => version.id,
  );

/** A Cuso version's number (cmo-v15 is 15); null for a model trial. */
function cmoVersionNumber(id: string | null | undefined): number | null {
  const match = /^cmo-v(\d+)$/.exec(id ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * What an owner reads after their Cuso moved from one version to a newer
 * one: the `whatsNew` lines of every version the move skipped over, newest
 * first, at most four. Empty for a move that is not an upgrade.
 */
export function cmoWhatsNew(
  fromVersionId: string | null | undefined,
  toVersionId: string | null | undefined,
): string[] {
  const from = cmoVersionNumber(fromVersionId);
  const to = cmoVersionNumber(toVersionId);
  if (from === null || to === null || to <= from) return [];
  return SOKO_BOT_PRODUCT_VERSIONS.filter((version) => {
    const n = cmoVersionNumber(version.id);
    return n !== null && n > from && n <= to;
  })
    .reverse()
    .flatMap((version) => version.whatsNew ?? [])
    .slice(0, 4);
}

export type { SokoBotSkill, SokoBotVersion };
export {
  applyRouteSteeringPrompt,
  getSokoBotSkill,
  ROUTE_STEERING_ACT_OR_ASK_SECTION,
  SOKO_BOT_SKILLS,
};

export function getSokoBotVersion(
  id: string | null | undefined,
): SokoBotVersion {
  const version = [...SOKO_BOT_VERSIONS, ...SOKO_BOT_PRODUCT_VERSIONS].find(
    (candidate) => candidate.id === id,
  );
  if (version) return version;
  const fallback = SOKO_BOT_VERSIONS.find(
    (candidate) => candidate.id === DEFAULT_SOKO_BOT_VERSION_ID,
  );
  if (!fallback) throw new Error("Default Soko Bot version is missing");
  return fallback;
}

/**
 * Versions and skills are written for a personal assistant and stay frozen
 * once they have lab history, so a shared bot reads them through this.
 */
export const SHARED_SOKO_BOT_GUIDANCE = [
  "# You are a shared assistant",
  'You have no owner: every member of the team can ask you for help. Wherever these instructions, tool results or packets say "the owner" or "your owner", that means the member who asked you in a turn a member started, and the team in a turn you started yourself (a schedule, a Task event or mail). There is no owner\'s chat: you speak in your shared room, where every member can read what you write.',
].join("\n");

/** A tool's description as this version's bot reads it. */
export function sokoBotToolDescription(
  capability: SokoBotCapability,
  version: Pick<SokoBotVersion, "texts">,
): string {
  return version.texts === "cmo"
    ? cusoToolDescription(capability)
    : SOKO_BOT_TOOL_DESCRIPTIONS[capability];
}

/** Who the bot is told it is, ahead of its operating instructions. */
export function sokoBotIdentity(
  version: Pick<SokoBotVersion, "texts">,
): string {
  return version.texts === "cmo"
    ? CUSO_IDENTITY
    : "You are Soko Bot, the owner's autonomous Sokosumi project manager. Your operating instructions arrive each turn as the versioned OPERATING INSTRUCTIONS block; follow them exactly.";
}

/** Resolves a skill by id with any version-flagged text transforms applied. */
export function getSokoBotSkillForVersion(
  id: string,
  version: Pick<SokoBotVersion, "e1Prompts">,
): SokoBotSkill {
  return applyE1Skill(getSokoBotSkill(id), version);
}

/**
 * The skills in the system prompt: every one in full, or for a version that
 * loads skills on demand, the every-turn ones and the index. That prompt is
 * then the same on every turn of the version, so the provider caches it.
 */
function systemSkillsPrompt(
  version: SokoBotVersion,
  turn: SokoBotPromptTurn | undefined,
): string[] {
  if (!version.skillsOnDemand)
    return cmoTurnSkills(version.skills, turn?.clientTurnId).map((id) =>
      getSokoBotSkillForVersion(id, version).content.trim(),
    );
  const { always, indexed } = splitSkillsForTurn(version, []);
  const index = skillIndexSection(
    indexed.map((id) => getSokoBotSkillForVersion(id, version)),
    version.profile === "cmo",
    version.e1Prompts ? E1_SKILL_USE_WHEN_OVERRIDES : undefined,
  );
  return [
    ...always.map((id) =>
      getSokoBotSkillForVersion(id, version).content.trim(),
    ),
    ...(index ? [index] : []),
  ];
}

/** What Core knows about a turn before the model starts. */
export interface SokoBotPromptTurn {
  clientTurnId: string | null;
  /** The turn's kind, route and source, as `SkillOccasion`s. */
  occasions?: readonly string[];
}

/**
 * Base prompt followed by the turn's skills: every skill in full, or for a
 * version that loads skills on demand, the ones the turn always needs and
 * an index of the rest.
 */
export function composeSystemPrompt(
  version: SokoBotVersion,
  persona?: SokoBotPersona,
  turn?: SokoBotPromptTurn,
): string {
  const perBot = version.skillsOnDemand ? [] : personaPrompt(version, persona);
  const basePrompt = applyE1SystemPrompt(
    version.routeSteering
      ? applyRouteSteeringPrompt(version.systemPrompt)
      : version.systemPrompt,
    version,
  );
  return [
    ...perBot.slice(0, 1),
    basePrompt,
    ...systemSkillsPrompt(version, turn),
    ...perBot.slice(1),
  ].join("\n\n");
}

/** Who this bot is: its persona, and the shared-bot guidance for a team's. */
function personaPrompt(
  version: SokoBotVersion,
  persona: SokoBotPersona | undefined,
): string[] {
  if (!persona) return [];
  return [
    version.texts === "cmo"
      ? composeCusoPersona(persona.name?.trim() || "Cuso")
      : composeSokoBotPersona(persona),
    ...(persona.shared ? [SHARED_SOKO_BOT_GUIDANCE] : []),
  ];
}

/**
 * For a version that loads skills on demand, what its system prompt leaves
 * to the turn's first message: the skills this kind of turn always needs,
 * then this bot's persona. Empty for every other version.
 */
export function composeTurnPreamble(
  version: SokoBotVersion,
  persona?: SokoBotPersona,
  turn?: SokoBotPromptTurn,
): string {
  if (!version.skillsOnDemand) return "";
  const { forTurn } = splitSkillsForTurn(version, turn?.occasions ?? []);
  return [
    turnSkillsSection(
      forTurn.map((id) => getSokoBotSkillForVersion(id, version)),
    ),
    ...personaPrompt(version, persona),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RESULT_CARD_SKILLS = new Set([
  "chat-result-previews",
  "result-cards",
  "result-cards-send-message",
]);

/** Whether the version teaches the bot to attach result cards. */
export function versionShowsResultCards(
  version: Pick<SokoBotVersion, "skills">,
): boolean {
  return version.skills.some((id) => RESULT_CARD_SKILLS.has(id));
}

/**
 * Route ceiling ∩ version allowlist; a version narrows, it never widens. The
 * one exception is a product's own tools: a CMO bot always carries its Brand
 * Brain and strategy tools, and no other bot ever does. It always carries
 * the competitor tools too, which other bots get from their route.
 */
export function applyVersionCapabilities(
  version: SokoBotVersion,
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  const cmo = version.profile === "cmo";
  const messagingTools: readonly SokoBotCapability[] =
    version.messaging === "send_message"
      ? ["post_chat", "open_direct_chat", "ask_coworker"]
      : ["send_message", "list_recipients"];
  const routed = capabilities.filter(
    (capability) =>
      capability !== "read_skill" &&
      !isSokoBotCmoCapability(capability) &&
      !(cmo && isSokoBotCompetitorCapability(capability)) &&
      !messagingTools.includes(capability) &&
      // Only a small packet (v38) has a map for read_context to read from.
      (capability !== "read_context" ||
        (!cmo && readsContextOnDemand(version.skills))),
  );
  const allowed = version.capabilities
    ? routed.filter((capability) =>
        (version.capabilities as readonly string[]).includes(capability),
      )
    : routed;
  // A version that loads skills on demand reads them, writing skills too.
  const skillReads: SokoBotCapability[] = version.skillsOnDemand
    ? ["read_skill"]
    : [];
  return cmo
    ? [
        ...allowed,
        ...skillReads,
        // Core's month writer belongs to the production skill that calls it.
        ...SOKO_BOT_CMO_CAPABILITIES.filter(
          (capability) =>
            !(version.skillsOnDemand && capability === "read_writing_skill") &&
            (capability !== "write_month_pieces" ||
              cmoWritesMonthAtOnce(version.skills)) &&
            (capability !== "write_strategy" ||
              cmoWritesStrategyStep(version.skills)) &&
            (!isSokoBotCmoReadCapability(capability) ||
              cmoReadsOnDemand(version.skills)),
        ),
        ...SOKO_BOT_COMPETITOR_CAPABILITIES,
      ]
    : [...allowed, ...skillReads];
}
