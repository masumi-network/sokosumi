import prisma from "@/lib/db/prisma";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { startCmoResearch } from "@/services/cmo-hiring.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import { newestMarketingStrategy } from "@/services/marketing-strategy.service";
import { SETTLED_TURN_STATUSES } from "@/services/soko-bot-lab-scenario.service";
import { brandBrainChecks, strategyChecks } from "./cmo-brand-checks";
import type {
  CaseContext,
  CaseOutcome,
  CasePoll,
  CaseStart,
} from "./eval-case-runner";
import type { CmoEvalCase } from "./eval-cmo-cases";
import type { EvalLaneRecord } from "./eval-lanes.service";

/** Research reads a whole site; a plan is one long turn. */
const CMO_TURN_TIMEOUT_MS = 45 * 60_000;

async function cusoIsBusy(lane: EvalLaneRecord) {
  return (
    (await prisma.sokoBotTurn.count({
      where: {
        sokoBotId: lane.cusoBotId,
        status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
      },
    })) > 0
  );
}

/** The lane's Cuso Project pointed at the brand, with nothing an earlier case left. */
async function pointCusoAt(
  lane: EvalLaneRecord,
  brand: { url: string },
  brandBrain: unknown,
) {
  const projectId = lane.cusoProjectId;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      websiteUrl: brand.url,
      designMdUrl: null,
      designMdExtractionId: null,
    },
  });
  await prisma.marketingStrategy.deleteMany({ where: { projectId } });
  await prisma.brandBrain.deleteMany({ where: { projectId } });
  if (brandBrain)
    await prisma.brandBrain.create({
      data: { projectId, body: brandBrain as object, updatedAt: new Date() },
    });
  const cuso = await findCusoForBot(lane.cusoBotId);
  if (!cuso) throw new Error(`Eval lane ${lane.lane} has no Cuso`);
  return cuso;
}

export async function startCmoCase(
  evalCase: CmoEvalCase,
  lane: EvalLaneRecord,
  _context: CaseContext,
): Promise<CaseStart> {
  if (await cusoIsBusy(lane)) return { kind: "busy" };
  if (evalCase.kind === "cmo-research") {
    const cuso = await pointCusoAt(lane, evalCase.brand, null);
    const { turnId } = await startCmoResearch(cuso, lane.userId);
    return { kind: "started", turnId, state: {} };
  }
  await pointCusoAt(lane, evalCase.brand, evalCase.brandBrain);
  const { turnId } = await requestCmoStrategy({ userId: lane.userId });
  return { kind: "started", turnId, state: {} };
}

async function settledTurn(turnId: string) {
  return prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { status: true, errorKind: true, finalAnswer: true },
  });
}

export async function pollCmoCase(
  evalCase: CmoEvalCase,
  lane: EvalLaneRecord,
  result: { turnId: string | null; state: unknown },
  context: CaseContext,
): Promise<CasePoll> {
  if (!result.turnId)
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {},
        error: "The case has no turn",
        turnIds: [],
      },
    };
  const turn = await settledTurn(result.turnId);
  if (!SETTLED_TURN_STATUSES.includes(turn.status)) {
    if (Date.now() - context.startedAt.getTime() < CMO_TURN_TIMEOUT_MS)
      return { kind: "waiting" };
    return {
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        output: {},
        error: "Cuso's turn did not settle in 45 minutes",
        turnIds: [result.turnId],
      },
    };
  }
  const completed = {
    label: "Turn completed",
    pass: turn.status === "COMPLETED",
    actual: turn.errorKind ? `${turn.status} (${turn.errorKind})` : turn.status,
  };
  const projectId = lane.cusoProjectId;
  let outcome: Omit<CaseOutcome, "status" | "turnIds">;
  if (evalCase.kind === "cmo-research") {
    const saved = await prisma.brandBrain.findUnique({ where: { projectId } });
    const { brain, checks } = brandBrainChecks(evalCase.brand, saved?.body);
    outcome = {
      checks: [completed, ...checks],
      output: {
        answer: turn.finalAnswer,
        summary: brain?.summary ?? null,
        offers: brain?.offers.map((offer) => `${offer.name} (${offer.price})`),
      },
    };
  } else {
    const saved = await newestMarketingStrategy(projectId);
    const { strategy, checks } = strategyChecks(evalCase.brand, saved?.plan);
    outcome = {
      checks: [completed, ...checks],
      output: {
        answer: turn.finalAnswer,
        summary: strategy?.summary ?? null,
        offer: strategy?.offer?.what ?? null,
        contentLanguage: strategy?.contentLanguage ?? null,
        pillars: strategy?.pillars.map((pillar) => pillar.name),
        calendar: strategy?.calendar
          .filter((entry) => entry.status !== "skipped")
          .map((entry) => `${entry.date} ${entry.channel}: ${entry.title}`),
      },
    };
  }
  return {
    kind: "done",
    outcome: {
      ...outcome,
      status: outcome.checks.every((check) => check.pass) ? "PASSED" : "FAILED",
      turnIds: [result.turnId],
    },
  };
}
