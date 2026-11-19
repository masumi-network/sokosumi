import {
  type SaveCompetitorFeedInput,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import { sokoBotProjectRefusal } from "@/lib/soko-bot/write-scope";
import {
  runCusoCompetitorCheck,
  saveCusoCompetitorFeed,
} from "@/services/cmo-competitors.service";
import { findCusoForBot, isCmoProject } from "@/services/cmo-cuso.service";
import { runProjectCompetitorCheck } from "@/services/competitor-check.service";
import {
  CompetitorFeedRefusedError,
  readCompetitorSignals,
  saveCompetitorFeed,
} from "@/services/competitor-feed.service";

import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/**
 * The Project a bot's competitor call is about: its own, or the one it
 * names, in the turn's workspace. Its weekly check must be on (a CMO
 * Project's always is), and only CMO writes to a CMO Project (ADR 0066).
 */
async function competitorProject(
  authorized: AuthorizedSokoBotRuntime,
  named: string | undefined,
  write: boolean,
): Promise<string> {
  const scope = authorized.reader.sharedScope;
  const projectId = named ?? scope?.projectId;
  if (!projectId)
    throw new SokoBotRuntimeValidationError(
      "Say which Project: pass its projectId.",
    );
  const refusal = sokoBotProjectRefusal(scope, [projectId]);
  if (refusal) throw new SokoBotRuntimeAuthorizationError(refusal);
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      workspaceId: authorized.turn.workspaceId,
      closedAt: null,
    },
    select: { competitorChecksSince: true },
  });
  if (!project)
    throw new SokoBotRuntimeValidationError("That Project was not found.");
  const cmo = await isCmoProject(projectId);
  if (cmo && write)
    throw new SokoBotRuntimeAuthorizationError(
      "CMO runs this Project and writes its competitor feed. You can read it with check_competitors.",
    );
  if (!cmo && !project.competitorChecksSince)
    throw new SokoBotRuntimeValidationError(
      "The weekly competitor check is off for this Project. A member turns it on on the Project's Competitors page.",
    );
  return projectId;
}

/**
 * The competitor tools: a Cuso on his own Project, on CMO's terms; any other
 * bot on a Project whose weekly check is on.
 */
export async function dispatchCompetitorTools(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  const now = new Date();
  if (input.capability === "check_competitors") {
    const { projectId: named } =
      SOKO_BOT_TOOL_INPUT_SCHEMAS.check_competitors.parse(input.input);
    const projectId =
      cuso?.projectId ?? (await competitorProject(authorized, named, false));
    if (cuso) await runCusoCompetitorCheck(cuso, now);
    else await runProjectCompetitorCheck(projectId, now);
    // Signals quote competitors' pages and articles: nothing in them may
    // reach an outward action in this turn.
    await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
      runtimeEvent(WEB_TAINT_EVENT, { source: "check_competitors" }),
    );
    return readCompetitorSignals(projectId, now);
  }
  const { projectId: named, ...feed }: SaveCompetitorFeedInput =
    SOKO_BOT_TOOL_INPUT_SCHEMAS.save_competitor_feed.parse(input.input);
  try {
    const saved = cuso
      ? await saveCusoCompetitorFeed({
          projectId: cuso.projectId,
          sokoBotId: cuso.sokoBotId,
          turnId: authorized.turn.id,
          feed,
          now,
        })
      : await saveCompetitorFeed({
          projectId: await competitorProject(authorized, named, true),
          turnId: authorized.turn.id,
          feed,
          now,
        });
    await addOverhead(authorized.turn.id, saved.costUsd);
    return {
      saved: saved.saved,
      bigMoves: saved.bigMoves,
      // Core told the owner about the week in Cuso's room, as one message.
      postedToChat: cuso !== null && saved.saved > 0,
    };
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
