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
];
export const DEFAULT_SOKO_BOT_VERSION_ID = "v11";

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

/** Route ceiling ∩ version allowlist; a version narrows, it never widens. */
export function applyVersionCapabilities(
  version: SokoBotVersion,
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  if (!version.capabilities) return [...capabilities];
  const allowed = new Set<SokoBotCapability>(version.capabilities);
  return capabilities.filter((capability) => allowed.has(capability));
}
