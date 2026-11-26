/**
 * The held-out owner journeys: a second set nobody iterates on, written from
 * real prod requests and kept out of the repository so builders never see
 * them. A run loads them from a file outside it (`evals:local --holdout
 * FILE`): a JSON array, or a TypeScript module exporting `HELDOUT_JOURNEYS`.
 * The fleet-move bar must hold on both sets, and a gain on the dev set with a
 * drop here is overfitting. They use the same world and checks as the dev
 * journeys (`journeys.ts`); what a prepare seeds comes from each journey's
 * own `fixtures`, so nothing of the set lives here.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { JourneyOutcome, JourneyStep, OwnerJourney } from "./journeys";

export const HOLDOUT_PREFIX = "owner-holdout-";

/** Each held-out journey runs this often: pass^1 and pass^3 tell luck from a real change. */
export const HOLDOUT_REPEATS = 3;

const STEP_KINDS = new Set<JourneyStep["kind"]>([
  "owner",
  "coworker",
  "schedule_fires",
  "teammate",
]);
const OUTCOME_KINDS = new Set<JourneyOutcome["kind"]>([
  "delivered",
  "schedule",
  "task",
  "images",
  "posts",
  "noPosts",
  "nothingSent",
  "launchSequence",
  "networkShift",
  "noPostsOnWeekday",
  "seededPostFixed",
  "table",
  "newsletterDraft",
  "readSeededFile",
  "seededSchedulesUntouched",
  "contact",
  "file",
  "taskReply",
  "scheduledPosts",
  "publishedUntouched",
  "seededPictureReplaced",
  "noHires",
]);
const PREPARE = new Set([
  "padierfind-without-x",
  "launch-one-pager-pdf",
  "customer-story-pdf",
  "outdated-price-post",
  "workspace-schedules",
  "weekly-reports",
  "friday-and-linkedin-posts",
  "investor-notes",
  "tasks",
  "teammate-room",
  "scheduled-posts",
  "picture-posts",
  "agent",
]);
/** The fixture each prepare seeds from. */
const PREPARE_FIXTURE: Record<
  string,
  keyof NonNullable<OwnerJourney["fixtures"]>
> = {
  tasks: "tasks",
  "scheduled-posts": "scheduledPosts",
  "picture-posts": "picturePosts",
  agent: "agent",
};
const TEAMMATES = new Set(["Hannah", "Alex"]);
const CUSO_SETUPS = new Set([
  "cmo-brand",
  "cmo-new-client",
  "cmo-weekly-review",
  "cmo-plan",
  "cmo-report",
]);

/** What is wrong with one journey from the file; empty when it can run. */
export function holdoutProblems(raw: unknown, index: number): string[] {
  const at = `journey ${index + 1}`;
  if (!raw || typeof raw !== "object") return [`${at}: not an object`];
  const journey = raw as Partial<OwnerJourney>;
  const problems: string[] = [];
  if (!journey.id?.startsWith(HOLDOUT_PREFIX))
    problems.push(`${at}: id must start with "${HOLDOUT_PREFIX}"`);
  if (journey.bot !== "soko-bot" && journey.bot !== "cuso")
    problems.push(`${at}: bot must be "soko-bot" or "cuso"`);
  for (const field of ["title", "intent", "rubric"] as const)
    if (typeof journey[field] !== "string" || !journey[field])
      problems.push(`${at}: ${field} is required`);
  if (!["easy", "medium", "hard"].includes(journey.level ?? ""))
    problems.push(`${at}: level must be easy, medium or hard`);
  if (journey.bot === "cuso" && !CUSO_SETUPS.has(journey.cusoSetup ?? ""))
    problems.push(`${at}: a Cuso journey needs a cusoSetup`);
  if (journey.bot === "soko-bot" && journey.cusoSetup)
    problems.push(`${at}: cusoSetup is for Cuso journeys only`);
  for (const prepare of journey.prepare ?? []) {
    if (!PREPARE.has(prepare))
      problems.push(`${at}: unknown prepare "${prepare}"`);
    const fixture = PREPARE_FIXTURE[prepare];
    if (fixture && !journey.fixtures?.[fixture])
      problems.push(`${at}: prepare "${prepare}" needs fixtures.${fixture}`);
  }
  const steps: JourneyStep[] = Array.isArray(journey.steps)
    ? journey.steps
    : [];
  if (steps[0]?.kind !== "owner" && steps[0]?.kind !== "teammate")
    problems.push(`${at}: the first step is a member's message`);
  steps.forEach((step, stepIndex) => {
    const where = `${at}, step ${stepIndex + 1}`;
    if (!STEP_KINDS.has(step?.kind)) problems.push(`${where}: unknown kind`);
    if ((step?.kind === "owner" || step?.kind === "teammate") && !step.message)
      problems.push(`${where}: a message step needs a message`);
    if (step?.kind === "teammate") {
      if (!TEAMMATES.has(step.member))
        problems.push(`${where}: the teammate must be Hannah or Alex`);
      if (!journey.prepare?.includes("teammate-room"))
        problems.push(`${where}: a teammate step needs the teammate-room`);
    }
    for (const outcome of step?.outcomes ?? [])
      if (!OUTCOME_KINDS.has(outcome?.kind))
        problems.push(`${where}: unknown outcome "${String(outcome?.kind)}"`);
      else
        problems.push(
          ...outcomeProblems(outcome).map((problem) => `${where}: ${problem}`),
        );
  });
  return problems;
}

/**
 * What is wrong with one outcome of any journey, dev or held out. A delivery
 * with no content to find passes any reply long enough, a promise included.
 */
export function outcomeProblems(outcome: JourneyOutcome): string[] {
  if (
    outcome.kind === "delivered" &&
    !outcome.textMatches?.length &&
    !outcome.facts?.length
  )
    return [
      `delivered "${outcome.label}" must say what content it needs (textMatches or facts)`,
    ];
  return [];
}

/** A JSON array, or a module's `HELDOUT_JOURNEYS` (run under tsx for TypeScript). */
function readSet(path: string): unknown {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const loaded = createRequire(import.meta.url)(path) as {
    HELDOUT_JOURNEYS?: unknown;
  };
  return loaded.HELDOUT_JOURNEYS;
}

/** The held-out journeys of `OWNERBENCH_HOLDOUT_FILE`; none when it is unset. */
export function holdoutJourneys(
  path = process.env.OWNERBENCH_HOLDOUT_FILE,
): OwnerJourney[] {
  if (!path) return [];
  const parsed = readSet(path);
  const list = Array.isArray(parsed) ? parsed : [];
  const problems = list.flatMap((journey, index) =>
    holdoutProblems(journey, index),
  );
  if (!Array.isArray(parsed) || list.length === 0)
    problems.unshift(
      "the file must hold a non-empty array of journeys (JSON, or HELDOUT_JOURNEYS)",
    );
  if (problems.length)
    throw new Error(
      `Held-out journeys in ${path}:\n- ${problems.join("\n- ")}`,
    );
  return list as OwnerJourney[];
}
