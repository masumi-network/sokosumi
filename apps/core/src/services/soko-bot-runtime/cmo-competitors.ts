import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import { runCompetitorCheck } from "@/services/cmo-competitor-check.service";
import {
  CompetitorFeedRefusedError,
  readCompetitorSignals,
  saveCompetitorFeed,
} from "@/services/cmo-competitor-feed.service";
import { findCusoForBot } from "@/services/cmo-cuso.service";

import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/** Cuso's competitor tools, on his own Project only. */
export async function dispatchCompetitorTools(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  if (!cuso)
    throw new SokoBotRuntimeValidationError(
      "Competitors belong to a Cuso's Project, and this bot has none.",
    );
  const now = new Date();
  if (input.capability === "check_competitors") {
    SOKO_BOT_TOOL_INPUT_SCHEMAS.check_competitors.parse(input.input);
    await runCompetitorCheck(cuso, now);
    // Signals quote competitors' pages and articles: nothing in them may
    // reach an outward action in this turn.
    await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
      runtimeEvent(WEB_TAINT_EVENT, { source: "check_competitors" }),
    );
    return readCompetitorSignals(cuso.projectId, now);
  }
  const feed = SOKO_BOT_TOOL_INPUT_SCHEMAS.save_competitor_feed.parse(
    input.input,
  );
  try {
    const saved = await saveCompetitorFeed({
      projectId: cuso.projectId,
      sokoBotId: cuso.sokoBotId,
      turnId: authorized.turn.id,
      feed,
      now,
    });
    await addOverhead(authorized.turn.id, saved.costUsd);
    return { saved: saved.saved, bigMoves: saved.bigMoves };
  } catch (error) {
    if (error instanceof CompetitorFeedRefusedError) {
      await addOverhead(authorized.turn.id, error.costUsd);
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  }
}

/** Jev's reading is overhead like routing: on the turn's total. */
async function addOverhead(turnId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  await prisma.sokoBotTurn.update({
    where: { id: turnId },
    data: {
      overheadCostUsdMicros: {
        increment: BigInt(Math.round(costUsd * 1_000_000)),
      },
    },
  });
}
