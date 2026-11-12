/**
 * Hard rules a save_strategy call must keep after Core merges the part into
 * the stored plan. The tool input is partial (plan / calendar / patch), so
 * Zod cannot reject a whole plan on one call; Core refuses the save when
 * `rules: true` and names each rule via `cmoPlanRuleProblems`.
 */
export const CMO_PLAN_HARD_RULES = {
  maxSummaryWords: 20,
  minPieces: 16,
  shareTolerance: 7,
} as const;
