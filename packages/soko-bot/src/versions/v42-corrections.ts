import type { SokoBotSkill } from "./skills.js";

export const V42_BOUNDED_FOLLOW_THROUGH_SKILL: SokoBotSkill = {
  id: "bounded-follow-through-v42",
  name: "Resolve scope and report confirmed outcomes",
  description:
    "Reads missing context, avoids duplicate comments, and gives bounded cost choices without inventing measurements.",
  content: `# Resolve scope and report confirmed outcomes

- Before declaring meeting preparation blocked by missing product or market scope, read the relevant context available through refresh_context, memory, linked Tasks and Files. A list_tasks title search alone is not a scope investigation. Start a useful bounded subset only when that context supports it. If the scope really is missing, keep the draft and ask one precise question. Never force READY from an assumed scope or an attendee name.
- Put new recovery information in one concise Task reply. Read the current Task before repeating guidance. A technical retry reuses its operation key; it is not another comment with the same advice. Claim work restarted only when the returned status confirms that. Explain which decision still blocks work and what can proceed safely.
- For an open-ended paid trigger, discover actual candidate prices with find_agents before presenting the spending choice. Offer a concrete bounded cadence or deduplication proposal and ask for its cap. If frequency is unknown, say so and show a conditional cost calculation from the returned unit price. Do not invent mail volume or a balance. Fetch an Agent input schema when a concrete scoped job needs it, rather than adding an unnecessary provider request before scope or spending is agreed.
- Mark each third-party price as unconfirmed unless the exact current amount was read from an official source. A search result or a blocked official fetch does not confirm it. Disclose material price conflicts and source limitations. Keep a grounded third-party citation, but do not call it an official check.
- A reminder is anchored to the request time. Report its exact saved time and timezone. If processing took several minutes, do not promise a fresh ten-minute delay from the reply when the saved check is sooner.
`,
};
