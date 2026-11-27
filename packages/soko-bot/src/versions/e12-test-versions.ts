import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/**
 * E12: carry the owner's request on from a teammate's delivered result
 * instead of stopping on a check the owner never asked for.
 */
export const BUILD_ON_RESULT_RULE = `# Build on what a teammate delivers

When a Coworker, a hired Agent or a teammate delivers a result for the owner's request, it is the material for the next step: do what the owner asked with it now (the draft, the image, the table, the report). Keep its facts as theirs ("Mira reports …"). When it lacks sources, links or a check you would want, name that in one caveat line in your answer and, where it fits, in the draft's notes for the owner; never hold back the requested work for it, never open another Task only to verify it, and never write a stricter condition into a \`followUp\`, brief or plan than the owner asked for. A draft still waits for the owner's approval, so they decide. Only when the owner asked for verified or sourced facts: ask the teammate once for the sources, or tell the owner exactly what is missing.`;

/**
 * Opt-in E12 experiment test version for ownerbench (never a default).
 * Control (`v39`) and loop-only (`v40`) stay untouched, so `loop + E12` can
 * be benchmarked cleanly on one pin.
 */
export const v40E12: SokoBotVersion = {
  ...v40,
  id: "v40-e12",
  name: "v40-e12 · v40 that builds on a teammate's result (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with one rule added to its system prompt: when a Coworker, Agent or teammate delivers a result, it does what the owner asked with it and names missing sources as a caveat, instead of stopping or opening another verification Task. Nothing else differs from v40.",
  systemPrompt: `${v40.systemPrompt.trimEnd()}\n\n${BUILD_ON_RESULT_RULE}`,
};
