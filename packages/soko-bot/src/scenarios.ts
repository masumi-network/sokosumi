import { FOUNDATION_SCENARIOS } from "./scenario-foundations.js";
import type { SokoBotScenario } from "./scenario-types.js";
import { WORKFLOW_SCENARIOS } from "./scenario-workflows.js";

export const SOKO_BOT_SCENARIOS: SokoBotScenario[] = [
  ...FOUNDATION_SCENARIOS,
  ...WORKFLOW_SCENARIOS,
];
