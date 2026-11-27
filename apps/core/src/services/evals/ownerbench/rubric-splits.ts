/**
 * Frozen atomic yes/no rubric splits for the owner benchmark's per-item judge.
 *
 * Dev splits live in `dev-rubric-splits.json` beside this file and are reviewed
 * in the repository (`docs/evals/benchmark/rubric-split-checklist.md`). Held-out
 * splits stay strictly outside the repository, loaded via `--splits FILE`
 * (`OWNERBENCH_SPLITS_FILE`) in the same way `--holdout` loads held-out journeys.
 *
 * Each split carries `rubricHash`, a SHA-256 prefix of `journey.rubric.trim()`,
 * so editing a journey's prose rubric without updating and reviewing its split
 * fails validation immediately instead of silently grading against stale criteria.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import devRubricSplitsJson from "./dev-rubric-splits.json";
import { HOLDOUT_PREFIX } from "./holdout";
import { OWNER_JOURNEYS, type OwnerJourney } from "./journeys";

export const RUBRIC_ITEM_KINDS = [
  "requirement",
  "constraint",
  "honesty",
] as const;

export type RubricItemKind = (typeof RUBRIC_ITEM_KINDS)[number];

export interface RubricItem {
  id: string;
  criterion: string;
  kind: RubricItemKind;
}

export interface JourneyRubricSplit {
  rubricHash: string;
  items: RubricItem[];
}

export const rubricItemSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
      "item id must be short snake_case (lowercase letters, digits, underscores)",
    )
    .min(2)
    .max(48),
  criterion: z.string().trim().min(10).max(500),
  kind: z.enum(RUBRIC_ITEM_KINDS),
});

export const journeyRubricSplitSchema = z.object({
  rubricHash: z
    .string()
    .regex(/^[0-9a-f]{16}$/, "rubricHash must be 16 lowercase hex chars"),
  items: z.array(rubricItemSchema).min(2).max(6),
});

/** Deterministic 16-char hash of a journey's prose rubric to catch split drift. */
export function rubricHash(rubric: string): string {
  return createHash("sha256").update(rubric.trim()).digest("hex").slice(0, 16);
}

/** What is wrong with one journey's split; empty when it can grade. */
export function rubricSplitProblems(
  label: string,
  raw: unknown,
  journey?: Pick<OwnerJourney, "rubric">,
): string[] {
  const parsed = journeyRubricSplitSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) =>
        `${label}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`,
    );
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  let honestyCount = 0;
  for (const item of parsed.data.items) {
    if (seen.has(item.id))
      problems.push(`${label}: duplicate item id "${item.id}"`);
    seen.add(item.id);
    if (item.kind === "honesty") honestyCount += 1;
  }
  if (honestyCount !== 1)
    problems.push(
      `${label}: expected exactly 1 honesty item, found ${honestyCount}`,
    );
  if (journey) {
    const expected = rubricHash(journey.rubric);
    if (parsed.data.rubricHash !== expected)
      problems.push(
        `${label}: rubricHash "${parsed.data.rubricHash}" does not match journey rubric "${expected}" (update and re-review the split)`,
      );
  }
  return problems;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Frozen dev splits from `dev-rubric-splits.json`, verified against `journeys`. */
export function devRubricSplits(
  journeys: readonly Pick<OwnerJourney, "id" | "rubric">[] = OWNER_JOURNEYS,
  rawMap: unknown = devRubricSplitsJson,
): Map<string, JourneyRubricSplit> {
  const record = asRecord(rawMap);
  if (!record)
    throw new Error("Dev rubric splits must be an object keyed by journey id");
  const problems: string[] = [];
  const expectedIds = new Set(journeys.map((journey) => journey.id));
  for (const id of Object.keys(record)) {
    if (id.startsWith(HOLDOUT_PREFIX))
      problems.push(
        `dev-rubric-splits.json must not hold private held-out journey splits`,
      );
    else if (!expectedIds.has(id))
      problems.push(`${id}: split exists for unknown dev journey`);
  }
  const splits = new Map<string, JourneyRubricSplit>();
  for (const journey of journeys) {
    const raw = record[journey.id];
    if (raw === undefined) {
      problems.push(`${journey.id}: missing frozen rubric split`);
      continue;
    }
    const itemProblems = rubricSplitProblems(journey.id, raw, journey);
    if (itemProblems.length) problems.push(...itemProblems);
    else splits.set(journey.id, journeyRubricSplitSchema.parse(raw));
  }
  if (problems.length)
    throw new Error(`Dev rubric splits:\n- ${problems.join("\n- ")}`);
  return splits;
}

/** A JSON object keyed by journey id, or a module's `HELDOUT_RUBRIC_SPLITS`. */
function readPrivateSplits(path: string): unknown {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const loaded = createRequire(import.meta.url)(path) as {
    HELDOUT_RUBRIC_SPLITS?: unknown;
  };
  return loaded.HELDOUT_RUBRIC_SPLITS;
}

/**
 * Private held-out splits from `OWNERBENCH_SPLITS_FILE`. Errors refer to
 * held-out journeys by 1-based index so held-out ids stay out of logs.
 */
export function holdoutRubricSplits(
  journeys: readonly Pick<OwnerJourney, "id" | "rubric">[],
  path = process.env.OWNERBENCH_SPLITS_FILE,
): Map<string, JourneyRubricSplit> {
  if (journeys.length === 0) return new Map();
  if (!path)
    throw new Error(
      "Per-item judging on held-out journeys requires private splits via --splits FILE (or OWNERBENCH_SPLITS_FILE).",
    );
  const record = asRecord(readPrivateSplits(path));
  if (!record)
    throw new Error(
      `Held-out rubric splits in ${path}: must be a JSON object or module exporting HELDOUT_RUBRIC_SPLITS`,
    );
  const problems: string[] = [];
  for (const id of Object.keys(record)) {
    if (!id.startsWith(HOLDOUT_PREFIX))
      problems.push(
        `private splits file may only contain "${HOLDOUT_PREFIX}*" keys (dev splits live in dev-rubric-splits.json)`,
      );
  }
  const splits = new Map<string, JourneyRubricSplit>();
  journeys.forEach((journey, index) => {
    const label = `held-out journey ${index + 1}`;
    const raw = record[journey.id];
    if (raw === undefined) {
      problems.push(`${label}: missing frozen rubric split`);
      return;
    }
    const itemProblems = rubricSplitProblems(label, raw, journey);
    if (itemProblems.length) problems.push(...itemProblems);
    else splits.set(journey.id, journeyRubricSplitSchema.parse(raw));
  });
  if (problems.length)
    throw new Error(
      `Held-out rubric splits in ${path}:\n- ${problems.join("\n- ")}`,
    );
  return splits;
}

/** Loads and validates frozen splits for every selected owner-benchmark journey. */
export function loadRubricSplitsForJourneys(
  journeys: readonly Pick<OwnerJourney, "id" | "rubric">[],
  privateSplitsPath = process.env.OWNERBENCH_SPLITS_FILE,
): Map<string, JourneyRubricSplit> {
  const devSelected = journeys.filter(
    (journey) => !journey.id.startsWith(HOLDOUT_PREFIX),
  );
  const heldOutSelected = journeys.filter((journey) =>
    journey.id.startsWith(HOLDOUT_PREFIX),
  );
  const combined = new Map<string, JourneyRubricSplit>();
  if (devSelected.length > 0) {
    const devAll = devRubricSplits();
    for (const journey of devSelected) {
      const split = devAll.get(journey.id);
      if (!split)
        throw new Error(
          `${journey.id}: missing frozen rubric split in dev-rubric-splits.json`,
        );
      combined.set(journey.id, split);
    }
  }
  for (const [id, split] of holdoutRubricSplits(
    heldOutSelected,
    privateSplitsPath,
  )) {
    combined.set(id, split);
  }
  return combined;
}
