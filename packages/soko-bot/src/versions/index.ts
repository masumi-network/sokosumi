import {
  CUSO_IDENTITY,
  composeCusoPersona,
  cusoToolDescription,
} from "../cmo-texts.js";
import { composeSokoBotPersona, type SokoBotPersona } from "../persona.js";
import {
  isSokoBotCmoCapability,
  isSokoBotCompetitorCapability,
  SOKO_BOT_CMO_CAPABILITIES,
  SOKO_BOT_COMPETITOR_CAPABILITIES,
  type SokoBotCapability,
} from "../policy.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import { CMO_MODEL_TRIALS } from "./cmo-model-trials.js";
import { CMO_BATCHED_PRODUCTION_SKILL } from "./cmo-skills.js";
import { cmoV1 } from "./cmo-v1.js";
import { cmoV2 } from "./cmo-v2.js";
import { cmoV3 } from "./cmo-v3.js";
import { cmoV4 } from "./cmo-v4.js";
import { cmoV5 } from "./cmo-v5.js";
import { cmoV6 } from "./cmo-v6.js";
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
];
export const DEFAULT_SOKO_BOT_VERSION_ID = "v33";

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
  ...CMO_MODEL_TRIALS,
];
/** The Cuso version a new hire starts on. */
export const CMO_SOKO_BOT_VERSION_ID = cmoV5.id;
/**
 * Every Cuso version. A Cuso stays on the version he was hired on until he is
 * moved, so finding one means any of these, never only the newest.
 */
export const CMO_SOKO_BOT_VERSION_IDS: readonly string[] =
  SOKO_BOT_PRODUCT_VERSIONS.filter((version) => version.profile === "cmo").map(
    (version) => version.id,
  );

export type { SokoBotSkill, SokoBotVersion };
export { getSokoBotSkill, SOKO_BOT_SKILLS };

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

/** Base prompt followed by every included skill. */
export function composeSystemPrompt(
  version: SokoBotVersion,
  persona?: SokoBotPersona,
): string {
  return [
    ...(persona
      ? [
          version.texts === "cmo"
            ? composeCusoPersona(persona.name?.trim() || "Cuso")
            : composeSokoBotPersona(persona),
        ]
      : []),
    version.systemPrompt.trim(),
    ...version.skills.map((id) => getSokoBotSkill(id).content.trim()),
    ...(persona?.shared ? [SHARED_SOKO_BOT_GUIDANCE] : []),
  ].join("\n\n");
}

const RESULT_CARD_SKILLS = new Set(["chat-result-previews", "result-cards"]);

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
  const routed = capabilities.filter(
    (capability) =>
      !isSokoBotCmoCapability(capability) &&
      !(cmo && isSokoBotCompetitorCapability(capability)),
  );
  const allowed = version.capabilities
    ? routed.filter((capability) =>
        (version.capabilities as readonly string[]).includes(capability),
      )
    : routed;
  return cmo
    ? [
        ...allowed,
        // Core's month writer belongs to the production skill that calls it.
        ...SOKO_BOT_CMO_CAPABILITIES.filter(
          (capability) =>
            capability !== "write_month_pieces" ||
            version.skills.includes(CMO_BATCHED_PRODUCTION_SKILL),
        ),
        ...SOKO_BOT_COMPETITOR_CAPABILITIES,
      ]
    : allowed;
}
