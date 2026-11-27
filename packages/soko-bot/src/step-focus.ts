import {
  SOKO_BOT_CMO_READ_CAPABILITIES,
  SOKO_BOT_DIRECT_READ_CAPABILITIES,
  type SokoBotCapability,
} from "./policy.js";

/**
 * Per-step focus options a host-filtered selector chooses from before each
 * agent step (`stepFocus` experiment).
 */
export const STEP_FOCUS_OPTIONS = [
  "inspect",
  "act",
  "verify",
  "answer",
] as const;

export type StepFocus = (typeof STEP_FOCUS_OPTIONS)[number];

export function isStepFocus(value: string): value is StepFocus {
  return (STEP_FOCUS_OPTIONS as readonly string[]).includes(value);
}

/**
 * Read-only capabilities outside `SOKO_BOT_DIRECT_READ_CAPABILITIES` that
 * gather context without mutating Sokosumi or external state, plus
 * `update_plan` so a planLoop turn can write or tick off its plan in any
 * tool-enabled step.
 */
const EXTRA_INSPECT_CAPABILITIES = [
  ...SOKO_BOT_CMO_READ_CAPABILITIES,
  "find_coworkers",
  "get_agent_input_schema",
  "read_skill",
  "read_writing_skill",
  "read_social_profile",
  "find_style_references",
  "list_social_comments",
  "read_seo",
  "research_keywords",
  "research_competitor_keywords",
  "check_search_rankings",
  "check_competitors",
  "search_exa",
  "web_search",
  "web_fetch",
  "workspace_read",
  "workspace_list",
  "workspace_search",
  "workspace_import_file",
  "run_subagent",
  "update_plan",
] as const satisfies readonly SokoBotCapability[];

/**
 * Exploratory / discovery capabilities allowed during `inspect` (and `act`),
 * but omitted from `verify` so verification stays focused on reading back
 * saved artifacts and checking Core receipts rather than opening fresh search
 * branches.
 */
const INSPECT_ONLY_CAPABILITIES: ReadonlySet<SokoBotCapability> = new Set([
  "web_search",
  "web_fetch",
  "search_exa",
  "run_subagent",
  "find_style_references",
  "research_keywords",
  "research_competitor_keywords",
  "find_integrations",
  "find_agents",
  "find_coworkers",
  "get_agent_input_schema",
  "workspace_import_file",
]);

/**
 * Capabilities in `SOKO_BOT_DIRECT_READ_CAPABILITIES` that can incur paid
 * external spend or write data depending on input (`investor_warm_paths` with
 * `research: true`), so they stay reserved for `act` only.
 */
const ACT_ONLY_DIRECT_CAPABILITIES: ReadonlySet<SokoBotCapability> = new Set([
  "investor_warm_paths",
]);

/**
 * Capabilities permitted in `inspect` steps. Fail-closed: any capability not
 * explicitly listed here is treated as a write/action tool (`act` only).
 */
export const STEP_FOCUS_INSPECT_CAPABILITIES: ReadonlySet<SokoBotCapability> =
  new Set<SokoBotCapability>(
    [
      ...SOKO_BOT_DIRECT_READ_CAPABILITIES,
      ...EXTRA_INSPECT_CAPABILITIES,
    ].filter((capability) => !ACT_ONLY_DIRECT_CAPABILITIES.has(capability)),
  );

/** Capabilities permitted in `verify` steps (read-back tools + `update_plan`). */
export const STEP_FOCUS_VERIFY_CAPABILITIES: ReadonlySet<SokoBotCapability> =
  new Set<SokoBotCapability>(
    [...STEP_FOCUS_INSPECT_CAPABILITIES].filter(
      (capability) => !INSPECT_ONLY_CAPABILITIES.has(capability),
    ),
  );

/** True when `capability` can mutate state, run shell commands, or incur external actions. */
export function isStepFocusWriteCapability(
  capability: SokoBotCapability,
): boolean {
  return !STEP_FOCUS_INSPECT_CAPABILITIES.has(capability);
}

export interface StepFocusBundles {
  inspect: SokoBotCapability[];
  act: SokoBotCapability[];
  verify: SokoBotCapability[];
  answer: SokoBotCapability[];
  /** Every capability both offered on the turn and granted by Core. */
  callable: SokoBotCapability[];
  /** Count of callable write/action tools; `act` is offered only when > 0. */
  writeCount: number;
}

/**
 * Computes deterministic, host-filtered tool bundles for each step focus.
 *
 * Selection never grants permission: every bundle is intersected with both the
 * turn's offered tools and Core's live granted capability set.
 */
export function buildStepFocusBundles(
  offered: readonly SokoBotCapability[],
  granted: readonly SokoBotCapability[],
): StepFocusBundles {
  const grantedSet = new Set<SokoBotCapability>(granted);
  const seen = new Set<SokoBotCapability>();
  const callable: SokoBotCapability[] = [];
  for (const capability of offered) {
    if (!grantedSet.has(capability) || seen.has(capability)) continue;
    seen.add(capability);
    callable.push(capability);
  }
  const inspect = callable.filter((capability) =>
    STEP_FOCUS_INSPECT_CAPABILITIES.has(capability),
  );
  const verify = callable.filter((capability) =>
    STEP_FOCUS_VERIFY_CAPABILITIES.has(capability),
  );
  const writeCount = callable.filter(isStepFocusWriteCapability).length;
  return {
    inspect,
    act: writeCount > 0 ? [...callable] : [],
    verify,
    answer: [],
    callable,
    writeCount,
  };
}

export type StepFocusValidation =
  | "accepted"
  | "single_candidate"
  | "low_confidence"
  | "invalid_candidate"
  | "missing_answer"
  | "stale_bundle"
  | "stale_repeat"
  | "jev_error"
  | "empty_menu";

export type StepFocusDecisionSource =
  | "jev"
  | "single_candidate"
  | "empty_menu_fallback";

export interface StepFocusRecentStep {
  stepIndex: number;
  focus: StepFocus | null;
  tools: {
    name: string;
    kind: "read" | "write";
    status: "ok" | "error" | "disallowed_by_focus";
  }[];
  hadText: boolean;
}

export interface StepFocusPlanSummary {
  revision: number;
  open: string[];
  doneCount: number;
  blocked: string[];
}

export interface StepFocusJevState {
  userRequest: string;
  turnKind: {
    source: string;
    background: boolean;
    routeHint: string | null;
  };
  stepIndex: number;
  roundIndex: number;
  stepsRemaining: number;
  plan: StepFocusPlanSummary | null;
  recentSteps: StepFocusRecentStep[];
  receipts: string[];
  hasPendingBlocker: boolean;
  availableBundles: {
    inspectCount: number;
    writeCount: number;
    verifyCount: number;
  };
}

/**
 * Persisted decision receipt for one step-focus decision.
 * Matches the keel receipt contract so E4's replay runner can re-evaluate
 * stored candidates and state against changed selector policies.
 */
export interface StepFocusDecisionReceipt {
  kind: "step_focus";
  decisionId: string;
  policyVersion: string;
  stepIndex: number;
  roundIndex: number;
  state: StepFocusJevState;
  candidates: StepFocus[];
  filteredOut: Partial<Record<StepFocus, string>>;
  source: StepFocusDecisionSource;
  rawChoice: string | null;
  probabilities: Partial<Record<StepFocus, number>> | null;
  abstained: boolean;
  validation: StepFocusValidation;
  usedFallback: boolean;
  appliedFocus: StepFocus;
  bundleToolCount: number;
  verifyReceiptsInjected: boolean;
  latencyMs: number;
  costUsd: number;
}

export interface StepFocusDecisionOutcome {
  kind: "step_focus_outcome";
  decisionId: string;
  stepIndex: number;
  appliedFocus: StepFocus;
  usedFallback: boolean;
  finishReason: string;
  toolCalls: {
    name: string;
    status: "ok" | "error" | "disallowed_by_focus";
  }[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}
