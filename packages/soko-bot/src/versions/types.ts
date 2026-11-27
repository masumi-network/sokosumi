import type { SokoBotCapability } from "../policy.js";

/**
 * A version is the complete, reviewable definition of how the assistant
 * behaves: model, system prompt, skills, and tool allowlist. Versions are
 * immutable once they have lab history — iterate by adding the next one.
 */
export interface SokoBotVersion {
  id: string;
  /**
   * Which product the bot is. Omitted means the personal assistant; `cmo` is
   * Cuso on cmo.xyz, with its own tools and rhythms.
   */
  profile?: "cmo";
  /**
   * Whose words the bot reads about itself and its tools. Omitted means Soko
   * Bot in Sokosumi; `cmo` is Cuso, whose owner never opens Sokosumi
   * (`cmo-texts.ts`).
   */
  texts?: "cmo";
  name: string;
  createdAt: string;
  summary: string;
  model: string;
  /**
   * A stronger model for the turns that need it: strategy, background runs,
   * orchestration and chat Jev reads as complex (`turn-model.ts` in Core).
   * Omit to run every turn on `model`.
   */
  strongModel?: string;
  systemPrompt: string;
  skills: readonly string[];
  /**
   * The system prompt carries an index of the skills and only those the turn
   * always needs in full (`skill-index.ts`); the bot reads the rest with
   * read_skill. Omitted: every skill in full on every turn, as before.
   */
  skillsOnDemand?: true;
  /**
   * Core runs update_plan on every runtime and keeps the plan for the whole
   * owner request (background runs, follow-up and watch wakes): the first
   * plan is the contract, and later turns of the request are shown it.
   * Omitted: update_plan is the sandbox's own turn-local list, as before.
   */
  planLoop?: true;
  /**
   * E1 route steering (Option D + keel menu rule):
   * - Filters Jev's route menu to routes the workspace and version can
   *   actually run before asking Jev, re-checks Jev's pick against that menu,
   *   and falls back cleanly on abstain, invalid, or stale picks.
   * - Omits trigger.route, trigger.confidence, trigger.unsureRoute, and
   *   version.skillOccasions from model-facing context (opening prompt and
   *   refresh_context) on foreground human chat turns, replacing the legacy
   *   route table with one Act-vs-Ask rule while Core gates remain the source
   *   of truth.
   * Autonomous turns and versions without this flag stay unchanged.
   */
  routeSteering?: true;
  /**
   * Jev routing classifier policy. Omitted or `"v3"` runs the legacy v3
   * questions, thresholds and revision (`soko-bot-classifier-jev-seo-v3`) so
   * live and control versions stay unchanged. `"v4"` opts into E1 PR 2's
   * v4 criteria, thresholds and revision (`soko-bot-classifier-jev-v4`).
   */
  classifierPolicy?: "v3" | "v4";
  /**
   * E1 prompt & skill improvements (outcome checklist, receipt/scope checks,
   * durable wakes over sleep polling, social scheduledAt clarity, tighter
   * chained-work skill index, and Cuso shared-Project TEAMMATE & change scope).
   * Omitted on all live and control versions.
   */
  e1Prompts?: true;
  /**
   * When true on a CMO bot (`profile === "cmo"`), an authenticated CMO project
   * owner (the workspace member who hired Cuso, or an organization `OWNER` in
   * Cuso's paying organization) is framed as `OWNER` in chat dispatch and
   * `trigger.askedBy`, while other workspace members stay `TEAMMATE` and
   * shared-bot data isolation (`sharedScope`) remains unchanged.
   * Omitted on all live and control versions.
   */
  cmoOwnerAudience?: true;
  /**
   * Core prepares live fitting candidates from its own records before the bot
   * asks (1 candidate: use it and say which; several: ask once and change
   * nothing; none: say what is missing) and checks `project_selection` against
   * those records. Omitted on all live, control, and loop-only versions.
   */
  askPolicy?: true;
  /**
   * CMO only: when a chat turn saves a new unapproved strategy version on a
   * project with an approved running month and upcoming unpublished posts,
   * Core updates the captured-preference hint and bounces the turn once if no
   * upcoming posts were updated yet. Omitted on all live, control, and
   * loop-only versions.
   */
  cmoApplyChanges?: true;
  /**
   * `send_message`: the bot reaches anyone through send_message and
   * list_recipients, and has no post_chat, open_direct_chat or ask_coworker.
   * Omitted: the reverse, as every version before v35 was written.
   */
  messaging?: "send_message";
  /** Tool allowlist on top of the route ceiling; omit for all. */
  capabilities?: readonly SokoBotCapability[];
  /** AI Gateway regional inference pin; omit for global routing. */
  inferenceRegion?: "eu" | "us";
  /**
   * What an owner is told, in the bot's own chat, when an administrator moves
   * their bot onto this version. Plain words about what changes for them;
   * omit to fall back to `summary`.
   */
  releaseNote?: string;
  /**
   * CMO only: what a Cuso owner reads in the app's "Cuso got better" dialog
   * after an administrator moves their Cuso onto this version. One short,
   * plain line each, for a founder who is not a marketer.
   */
  whatsNew?: readonly string[];
}
