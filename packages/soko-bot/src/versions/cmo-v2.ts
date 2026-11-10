import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v1 whose first read runs in six parts at once (SOKD-167): Core starts
 * one part per research group inside the research turn, each saves its own
 * sections and hands over its notes, then Cuso writes the essentials. Same
 * prompt, tools, model, sections and search cap; only the research order
 * changes.
 */
export const cmoV2: SokoBotVersion = {
  ...cmoV1,
  id: "cmo-v2",
  name: "cmo-v2 · Cuso, research in parallel",
  createdAt: "2026-11-10",
  summary:
    "Cuso on cmo-v1, whose first read researches the six Brand Brain groups side by side, then writes the essentials.",
  skills: cmoV1.skills.map((skill) =>
    skill === "cmo-brand-brain" ? "cmo-brand-brain-groups" : skill,
  ),
};
