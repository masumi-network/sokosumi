import type { SokoBotVersion } from "./types.js";
import { v27 } from "./v27.js";

export const v28: SokoBotVersion = {
  ...v27,
  id: "v28",
  name: "v28 · Contacts",
  createdAt: "2026-10-22",
  summary:
    "v27 that keeps the team's shared contacts: one entry per person with every channel, interactions logged as they happen, lists, and researched prospects with sources, without duplicates.",
  releaseNote:
    "I now keep your team's contacts: I add people without duplicates, log who was in touch and when, keep lists, and research prospects with sources.",
  skills: [...v27.skills, "contacts"],
};
