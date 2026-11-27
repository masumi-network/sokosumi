import { CONTEXT_ON_DEMAND_SKILL } from "./context-on-demand-skills.js";
import type { SokoBotVersion } from "./types.js";
import { v37 } from "./v37.js";
import {
  RESULT_CARDS_SEND_MESSAGE_SKILL,
  SOCIAL_POSTING_ACCOUNT_SKILL,
  SOKO_BOT_PLAYBOOKS_SKILL,
} from "./v39-skills.js";

/**
 * The next Soko Bot default (version plan, 2026-11-26): v37's X direct
 * messages, v38's small context packet with a map and reads (ADR 0086),
 * skills as an index read on demand with a prompt that stays the same between
 * turns (ADR 0085), the marketing playbooks, and social posting that asks
 * which account when several fit.
 */
export const v39: SokoBotVersion = {
  ...v37,
  id: "v39",
  name: "v39 · Short context, skills on demand, playbooks",
  createdAt: "2026-11-26",
  summary:
    "v37 that starts each turn from a short context with a map of everything else and reads the rest, loads its skills on demand behind a prompt that stays the same between turns, reads a playbook before writing pages, email sequences, outreach, launches and offers, and asks which account when several could take a post.",
  releaseNote:
    "I look up the exact Task, mail or contact you ask about, even an old one, follow a proven playbook when I write a page, an email sequence or a launch, and ask which account to post on when you have more than one.",
  skillsOnDemand: true,
  skills: [
    // v37's skills, two rewritten: posting that asks which account, and
    // result cards shared with send_message, the messaging tool v39 holds.
    ...v37.skills.map((skill) =>
      skill === "social-posting-instructions"
        ? SOCIAL_POSTING_ACCOUNT_SKILL
        : skill === "result-cards"
          ? RESULT_CARDS_SEND_MESSAGE_SKILL
          : skill,
    ),
    CONTEXT_ON_DEMAND_SKILL,
    SOKO_BOT_PLAYBOOKS_SKILL,
  ],
};
