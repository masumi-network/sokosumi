import type { SokoBotCapability } from "../policy.js";

/**
 * A version is the complete, reviewable definition of how the assistant
 * behaves: model, system prompt, skills, and tool allowlist. Versions are
 * immutable once they have lab history — iterate by adding the next one.
 */
export interface SokoBotVersion {
  id: string;
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
}
