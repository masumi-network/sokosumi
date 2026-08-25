import type { SokoBotCapability } from "../policy.js";

/**
 * A version is the complete, reviewable definition of how the assistant
 * behaves: model, system prompt, skills, and tool allowlist. Versions are
 * immutable once they have lab history — iterate by adding the next one.
 */
export interface SokoBotVersion {
  /** Stable id, e.g. "v3". */
  id: string;
  name: string;
  /** ISO date the version was authored. */
  createdAt: string;
  /** What changed versus the previous version, in one or two lines. */
  summary: string;
  /** AI Gateway model id; resolved per session by the Eve runtime. */
  model: string;
  /** Base system prompt; skills are appended after it. */
  systemPrompt: string;
  /** Skill ids from `SOKO_BOT_SKILLS`. */
  skills: readonly string[];
  /** Tool allowlist applied on top of the route ceiling; omit for all. */
  capabilities?: readonly SokoBotCapability[];
}
