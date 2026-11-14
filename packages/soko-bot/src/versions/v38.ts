import type { SokoBotVersion } from "./types.js";
import { v37 } from "./v37.js";

export const v38: SokoBotVersion = {
  ...v37,
  id: "v38",
  name: "v38 · Read current facts and keep required checks",
  createdAt: "2026-11-14",
  summary:
    "Reads current Contacts, uses confirmed team roles, keeps blocked-work checks active, and links newsletter drafts directly.",
  releaseNote:
    "I check current records, keep your requested check-ins active while work is blocked, and link saved newsletter drafts.",
  skills: [...v37.skills, "verified-state-v38"],
};
