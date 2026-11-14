/**
 * Behaviour scenarios: fixed prompts with the reaction we expect from the
 * assistant. Run them from the console after changing the system prompt,
 * classifier, or model to see whether the behaviour still holds. Prompts
 * are fixtures, so they stay in English regardless of the UI locale.
 *
 * They are ordered: later ones build on Tasks earlier ones create, so
 * "Run all" exercises create → inspect → clean up. A scenario with `setup`
 * starts from a clean slate instead, so its outcome does not hinge on what
 * the scenarios before it happened to leave behind.
 */
/** The slice of a finished turn the evaluator reads; the web detail DTO and the Core rows both satisfy it. */
export interface SokoBotLabTurn {
  /** Owner message or event text; ids it mentions are known, not invented. */
  userMessage?: string | null;
  /** Context packet the runtime received; its ids are known too. */
  contextPacket?: unknown;
  status: string;
  route: string | null;
  finalAnswer: string | null;
  toolCalls: {
    capability: string;
    status: string;
    input?: unknown;
    result: unknown;
  }[];
  events: { type: string; toolName: string | null }[];
  delegations: {
    id: string;
    taskId: string | null;
    jobId: string | null;
    action?: string | null;
    outcome?: string | null;
    /** The follow-up plan the bot attached when it delegated. */
    followUp?: string | null;
  }[];
  decisions: { id: string; resultingEntityId: string | null }[];
}

/** Simulated Coworker activity on the newest delegated Task; the bot reacts through an EVENT turn. */
export type SokoBotScenarioTrigger =
  | {
      kind: "task_event";
      status: "INPUT_REQUIRED" | "FAILED" | "COMPLETED";
      comment: string;
    }
  | {
      /** A self-started turn built from the connected accounts (needs Gmail/Calendar or recordings). */
      kind: "ingest";
      /**
       * `standup` and `weekly-wrap` are the two system schedules, run through
       * the same path the cron uses; `delta` is the hourly mail ingest. Between
       * them and `task_event` every automated trigger has lab coverage.
       */
      beat: "standup" | "weekly-wrap" | "dreaming" | "delta";
    };

export interface SokoBotScenario {
  id: string;
  title: string;
  /** What we want to see, in one line. */
  intent: string;
  /** Owner message that starts the turn; empty when a trigger starts it. */
  prompt: string;
  trigger?: SokoBotScenarioTrigger;
  /**
   * CLI lab: clear what earlier lab turns made (Tasks, schedules, files) and
   * the bot's memory, then seed these schedules (Europe/Berlin).
   */
  setup?: {
    schedules?: { name: string; cronExpression: string; prompt: string }[];
  };
  /** What a good outcome looks like, for the judge model. */
  rubric: string;
  expect: {
    routes: string[];
    /** Every one of these tools must be called. */
    tools?: string[];
    /** At least one of these tools must be called. */
    anyTools?: string[];
    /** None of these may be called. */
    forbiddenTools?: string[];
    /**
     * Tools whose failure the scenario sets up (a site that does not load),
     * so a failed call to one is not counted against the bot.
     */
    allowFailedTools?: string[];
    /** Minimum number of tasks/jobs the turn touched. */
    minDelegations?: number;
    /** Nothing may be delegated. */
    noDelegations?: boolean;
    /** The answer must ask the owner something. */
    asksQuestion?: boolean;
    /** The answer must not promise a later check without a schedule. */
    noEmptyPromise?: boolean;
    /**
     * A schedule the turn created or updated must name a Task the same turn
     * touched. Without it "called a schedule tool" passes a bot that pointed
     * the owner's daily check at whatever it happened to be watching before.
     */
    scheduleTargetsTouchedTask?: boolean;
    /** One real, non-recurring follow-up on the named Task, at the requested delay. */
    oneTimeTaskCheck?: { taskNamePattern: string; delayMinutes: number };
    /** Every UUID in the answer must appear in a tool result or delegation. */
    noInventedIds?: boolean;
    /** Must answer the Coworker (reply_to_task) or ask the owner one question. */
    respondsToCoworker?: boolean;
    /** The whole answer must match this regular expression (case-insensitive). */
    answerMatches?: string;
    /** The answer must not match this regular expression (case-insensitive). */
    answerAvoids?: string;
    /** Tasks it creates must stay DRAFT (no READY, no assignment). */
    draftsOnly?: boolean;
    /**
     * Work it delegated carries a follow-up plan, so "when it is done, do Y"
     * waits on the result itself instead of a schedule or a polling loop.
     */
    attachesFollowUp?: boolean;
    /**
     * Nothing was worth doing: no mutating tool, nothing delegated, and the
     * answer says so plainly. Without scenarios that reward restraint, every
     * check rewards activity and a bot inventing work to look busy scores well.
     */
    staysSilent?: boolean;
  };
}

/**
 * Persisted verbatim into `SokoBotLabRun.checks` (a Json column), so this is an
 * object type alias rather than an interface: only an alias carries the
 * implicit index signature that makes it checkable against Prisma's JSON input
 * types (ADR 0035).
 */
export type ScenarioCheck = {
  label: string;
  pass: boolean;
  actual: string;
};

export interface ScenarioResult {
  checks: ScenarioCheck[];
  passed: number;
  total: number;
}
