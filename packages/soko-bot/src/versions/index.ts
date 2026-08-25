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

/** Newest last. To iterate, add `vN.ts` and append it here. */
export const SOKO_BOT_VERSIONS: readonly SokoBotVersion[] = [v1, v2, v3, v4];
export const DEFAULT_SOKO_BOT_VERSION_ID = "v1";

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

export function isSokoBotVersionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SOKO_BOT_VERSIONS.some((version) => version.id === value)
  );
}

/** Base prompt followed by every included skill. */
export function composeSystemPrompt(
  version: SokoBotVersion,
  persona?: SokoBotPersona,
): string {
  return [
    ...(persona ? [composeSokoBotPersona(persona)] : []),
    version.systemPrompt.trim(),
    ...version.skills.map((id) => getSokoBotSkill(id).content.trim()),
  ].join("\n\n");
}

/** Route ceiling ∩ version allowlist; scratch tools always stay. */
export function applyVersionCapabilities(
  version: SokoBotVersion,
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  if (!version.capabilities) return [...capabilities];
  const allowed = new Set<SokoBotCapability>(version.capabilities);
  return capabilities.filter(
    (capability) =>
      allowed.has(capability) || capability.startsWith("scratch_"),
  );
}
