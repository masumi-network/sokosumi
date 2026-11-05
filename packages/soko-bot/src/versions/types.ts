import type { SokoBotCapability } from "../policy.js";

/**
 * A version is the complete, reviewable definition of how the assistant
 * behaves: model, system prompt, skills, and tool allowlist. Versions are
 * immutable once they have lab history — iterate by adding the next one.
 */
export interface SokoBotVersion {
  id: string;
  /**
   * Which product the bot is. Omitted means the personal assistant; `cmo` is
   * Cuso on cmo.xyz, with its own tools and rhythms.
   */
  profile?: "cmo";
  name: string;
  createdAt: string;
  summary: string;
  model: string;
  systemPrompt: string;
  skills: readonly string[];
  /** Tool allowlist on top of the route ceiling; omit for all. */
  capabilities?: readonly SokoBotCapability[];
  /** AI Gateway regional inference pin; omit for global routing. */
  inferenceRegion?: "eu" | "us";
  /**
   * What an owner is told, in the bot's own chat, when an administrator moves
   * their bot onto this version. Plain words about what changes for them;
   * omit to fall back to `summary`.
   */
  releaseNote?: string;
}
