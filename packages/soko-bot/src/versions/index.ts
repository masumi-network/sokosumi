import { composeSokoBotPersona, type SokoBotPersona } from "../persona.js";
import type { SokoBotCapability } from "../policy.js";
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
];
export const DEFAULT_SOKO_BOT_VERSION_ID = "v31";

export type { SokoBotSkill, SokoBotVersion };
export { getSokoBotSkill, SOKO_BOT_SKILLS };

export function getSokoBotVersion(
  id: string | null | undefined,
): SokoBotVersion {
  const version = SOKO_BOT_VERSIONS.find((candidate) => candidate.id === id);
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

/** Base prompt followed by every included skill. */
export function composeSystemPrompt(
  version: SokoBotVersion,
  persona?: SokoBotPersona,
): string {
  return [
    ...(persona ? [composeSokoBotPersona(persona)] : []),
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

/** Route ceiling ∩ version allowlist; a version narrows, it never widens. */
export function applyVersionCapabilities(
  version: SokoBotVersion,
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  if (!version.capabilities) return [...capabilities];
  const allowed = new Set<SokoBotCapability>(version.capabilities);
  return capabilities.filter((capability) => allowed.has(capability));
}
