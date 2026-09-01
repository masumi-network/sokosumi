/**
 * Grades the judge.
 *
 * Each case is a turn whose outcome was checked by hand against the tool
 * results and the context packet, so a model's verdict can be compared with
 * something better than another model's opinion. Runs every model given and
 * reports where each disagrees with the evidence, and what it charged for the
 * privilege — this judge runs on every settled turn, so a model that agrees
 * marginally more often is not automatically the one to run.
 */
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { judgeTurnWithModel } from "@/services/soko-bot-lab-judge.service";

const caseSchema = z.object({
  turnId: z.string().min(1),
  scenario: z.string().min(1),
  /** What the evidence supports, established by reading the turn. */
  honest: z.boolean(),
  /** Why, so a case can be argued with rather than taken on faith. */
  why: z.string().min(1),
});

// Parsed, not cast: a malformed case would otherwise slip past the length
// guard and be evaluated as dishonest, quietly scoring every model as wrong.
const parsedCases = z
  .array(caseSchema)
  .safeParse(JSON.parse(process.env.JUDGE_EVAL_CASES ?? "[]"));
if (!parsedCases.success) {
  console.error(`JUDGE_EVAL_CASES is malformed: ${parsedCases.error.message}`);
  process.exit(1);
}
const cases = parsedCases.data;
const models = (process.env.JUDGE_EVAL_MODELS ?? "")
  .split(",")
  .map((model) => model.trim());

if (cases.length === 0 || models.some((model) => model === "")) {
  console.error(
    "Set JUDGE_EVAL_CASES (non-empty) and JUDGE_EVAL_MODELS (comma-separated, no blanks).",
  );
  process.exit(1);
}

for (const model of models) {
  let agree = 0;
  let costUsd = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const call = await judgeTurnWithModel(c.turnId, model).catch(() => null);
    if (!call) {
      misses.push(`${c.scenario}: judge errored`);
      continue;
    }
    costUsd += call.usage.costUsd;
    // The honesty axis is the one under test: does the model call an answer
    // grounded when the evidence grounds it, and only then?
    const saidHonest = call.verdict.scores.honesty >= 4;
    if (saidHonest === c.honest) {
      agree += 1;
    } else {
      misses.push(
        `${c.scenario}: evidence says ${c.honest ? "honest" : "not honest"}, judge gave honesty ${call.verdict.scores.honesty}\n       why it says so: ${(call.verdict.issues ?? []).slice(0, 2).join(" | ").slice(0, 260)}`,
      );
    }
  }
  console.log(
    `\n${model}: ${agree}/${cases.length} match the evidence, $${costUsd.toFixed(4)} for the set`,
  );
  for (const miss of misses) console.log(`   - ${miss}`);
}

// Every case here is a turn the bot was honest on, so this measures false
// accusations only. Whether a judge catches a real fabrication needs a turn
// known to have lied, which nothing in this set is.
console.log(
  `\nMeasured against ${cases.filter((c) => c.honest).length} honest and ${cases.filter((c) => !c.honest).length} dishonest turns.`,
);

await prisma.$disconnect();
