/**
 * The held-out owner journeys: a second set nobody iterates on, written from
 * real prod requests and kept out of the repository so builders never see
 * them. A run loads them from a JSON file (`evals:local --holdout FILE`); the
 * fleet-move bar must hold on both sets, and a gain on the dev set with a
 * drop here is overfitting. They use the same world and checks as the dev
 * journeys (`journeys.ts`), so the file holds data only.
 */
import { readFileSync } from "node:fs";
import type { JourneyStep, OwnerJourney } from "./journeys";

export const HOLDOUT_PREFIX = "owner-holdout-";

const STEP_KINDS = new Set(["owner", "coworker", "schedule_fires"]);
const OUTCOME_KINDS = new Set([
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
]);
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
  for (const prepare of journey.prepare ?? [])
    if (!PREPARE.has(prepare))
      problems.push(`${at}: unknown prepare "${prepare}"`);
  const steps: JourneyStep[] = Array.isArray(journey.steps)
    ? journey.steps
    : [];
  if (steps[0]?.kind !== "owner")
    problems.push(`${at}: the first step is the owner's message`);
  steps.forEach((step, stepIndex) => {
    if (!STEP_KINDS.has(step?.kind))
      problems.push(`${at}, step ${stepIndex + 1}: unknown kind`);
    if (step?.kind === "owner" && !step.message)
      problems.push(`${at}, step ${stepIndex + 1}: owner step needs a message`);
    for (const outcome of step?.outcomes ?? [])
      if (!OUTCOME_KINDS.has(outcome?.kind))
        problems.push(
          `${at}, step ${stepIndex + 1}: unknown outcome "${String(outcome?.kind)}"`,
        );
  });
  return problems;
}

/** The held-out journeys of `OWNERBENCH_HOLDOUT_FILE`; none when it is unset. */
export function holdoutJourneys(
  path = process.env.OWNERBENCH_HOLDOUT_FILE,
): OwnerJourney[] {
  if (!path) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const list = Array.isArray(parsed) ? parsed : [];
  const problems = list.flatMap((journey, index) =>
    holdoutProblems(journey, index),
  );
  if (!Array.isArray(parsed) || list.length === 0)
    problems.unshift("the file must hold a non-empty JSON array of journeys");
  if (problems.length)
    throw new Error(
      `Held-out journeys in ${path}:\n- ${problems.join("\n- ")}`,
    );
  return list as OwnerJourney[];
}
