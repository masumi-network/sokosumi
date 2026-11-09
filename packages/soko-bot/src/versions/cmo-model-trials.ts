import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

function cmoV1On(slug: string, model: string, label: string): SokoBotVersion {
  return {
    ...cmoV1,
    id: `cmo-v1-${slug}`,
    name: `cmo-v1 on ${label} · model trial`,
    createdAt: "2026-11-09",
    model,
    inferenceRegion: undefined,
    summary: `Cuso's cmo-v1, word for word, on ${label}: a cheaper model to compare in the evals. Nobody is hired onto it.`,
  };
}

/**
 * cmo-v1 on models cheaper than GPT-6 Luna, for the eval comparison the owner
 * asked for on 2026-11-09: tool-use models on the Gateway that cost less than
 * Luna's $0.10/$0.50 per million tokens (DeepSeek's input costs $0.13, its
 * output half Luna's), chosen by OpenRouter's usage ranking.
 * Run one with `sokosumi evals run --suite cmo --cuso-version <id>`.
 */
export const CMO_MODEL_TRIALS: readonly SokoBotVersion[] = [
  cmoV1On("qwen37-flash", "alibaba/qwen3.7-flash", "Qwen3.7 Flash"),
  cmoV1On("gpt-oss-20b", "openai/gpt-oss-20b", "gpt-oss-20b"),
  cmoV1On(
    "deepseek-v4-flash",
    "deepseek/deepseek-v4-flash",
    "DeepSeek V4 Flash",
  ),
  cmoV1On(
    "gemini-25-flash-lite",
    "google/gemini-2.5-flash-lite",
    "Gemini 2.5 Flash Lite",
  ),
];
