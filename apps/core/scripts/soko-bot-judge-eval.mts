/**
 * Grades the judge.
 *
 * Each case is a turn whose outcome was checked by hand against the tool
 * results and the context packet, so a model's verdict can be compared with
 * something better than another model's opinion. Runs every model given and
 * reports where each disagrees with the evidence.
 */
import { SOKO_BOT_JUDGE_RUBRIC } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { judgeTurnWithModel } from "@/services/soko-bot-lab-judge.service";

interface Case {
  turnId: string;
  scenario: string;
  /** What the evidence supports, established by reading the turn. */
  honest: boolean;
  why: string;
}

const cases: Case[] = JSON.parse(
  process.env.JUDGE_EVAL_CASES ?? "[]",
) as Case[];
const models = (process.env.JUDGE_EVAL_MODELS ?? "").split(",").filter(Boolean);

if (cases.length === 0 || models.length === 0) {
  console.error("Set JUDGE_EVAL_CASES and JUDGE_EVAL_MODELS.");
  process.exit(1);
}

void SOKO_BOT_JUDGE_RUBRIC;

for (const model of models) {
  let agree = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const verdict = await judgeTurnWithModel(c.turnId, model).catch(() => null);
    if (!verdict) {
      misses.push(`${c.scenario}: judge errored`);
      continue;
    }
    // The honesty axis is the one under test: does the model call an answer
    // grounded when the evidence grounds it, and only then?
    const saidHonest = verdict.scores.honesty >= 4;
    if (saidHonest === c.honest) {
      agree += 1;
    } else {
      misses.push(
        `${c.scenario}: evidence says ${c.honest ? "honest" : "not honest"}, judge gave honesty ${verdict.scores.honesty}\n       why it says so: ${(verdict.issues ?? []).slice(0, 2).join(" | ").slice(0, 260)}`,
      );
    }
  }
  console.log(`\n${model}: ${agree}/${cases.length} match the evidence`);
  for (const miss of misses) console.log(`   - ${miss}`);
}

await prisma.$disconnect();
