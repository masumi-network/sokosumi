import type { SokoBotVersion } from "./types.js";
import { v33 } from "./v33.js";

const PREVIOUS_SPENDING_RULE =
  "The owner's request is the go-ahead for the Tasks and hires it needs: respect any budget they stated, and ask only when a price is far above what they would expect.";
const BOUNDED_SPENDING_RULE =
  "A direct request authorizes the one-off Tasks and hires it needs within any stated budget. Recurring or trigger-based paid work needs the owner's agreed frequency or trigger and a total cap, or a cap per period with a clear renewal period, before any hire, schedule, or active standing rule is saved. If either is missing, ask one question for the missing limit; do not accept the automation or promise future spending. Save it only as a pending decision or blocker until the owner answers. This also applies to an older memory rule: without these limits, it is pending and cannot authorize a hire. A bounded instruction already approved by the owner can proceed within those exact limits. Ordinary reporting preferences never authorize spending.";

export const v34: SokoBotVersion = {
  ...v33,
  id: "v34",
  name: "v34 · Verified work and bounded spending",
  createdAt: "2026-11-14",
  summary:
    "Resolves team lookups, recovers failed work, reads full source files, keeps table values grounded, avoids duplicate writes, and asks for limits before recurring paid work.",
  releaseNote:
    "I check the team directory before choosing people, recover work with concrete guidance, and read full files before summarizing them. I keep table values tied to evidence and ask for a spending limit before setting up recurring paid work.",
  systemPrompt: v33.systemPrompt.replace(
    PREVIOUS_SPENDING_RULE,
    BOUNDED_SPENDING_RULE,
  ),
  skills: [...v33.skills, "work-reliability-v34"],
};
