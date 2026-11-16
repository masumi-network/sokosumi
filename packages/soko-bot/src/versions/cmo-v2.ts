import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * Cuso with X first: cmo-v1 with a strategy skill that posts on X several
 * times a day, far more than on any other channel, one X post in three with
 * an image. Everything else is cmo-v1's.
 */
export const cmoV2: SokoBotVersion = {
  ...cmoV1,
  id: "cmo-v2",
  name: "cmo-v2 · Cuso, X first",
  createdAt: "2026-11-15",
  summary:
    "Cuso, posting on X three times a day at the All-in pace, one X post in three with an image; the other channels as in cmo-v1.",
  skills: cmoV1.skills.map((skill) =>
    skill === "cmo-strategy" ? "cmo-strategy-x-first" : skill,
  ),
};
