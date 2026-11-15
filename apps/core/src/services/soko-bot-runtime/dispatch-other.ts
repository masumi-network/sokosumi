import {
  sokoBotSearchInputSchema as searchInputSchema,
  sokoBotEvaluateWithJevInputSchema,
  sokoBotSearchExaInputSchema,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { ExaUnavailableError, searchExa } from "@/lib/soko-bot/exa";
import { evaluateWithJevForBot } from "@/lib/soko-bot/jev-tool";
import {
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { EXA_SEARCHES_PER_TURN } from "./execution-limits";
import { type RuntimeOperations } from "./operations";

export async function dispatchOtherTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "search_contacts":

    case "count_contacts":

    case "search_companies":

    case "get_company":

    case "update_company":

    case "bulk_update_contacts":

    case "get_contact":

    case "list_contact_lists":

    case "find_contact_duplicates":

    case "upsert_contact":

    case "update_contact":

    case "log_contact_interaction":

    case "merge_contacts":

    case "manage_contact_lists":
      return runtime.executeContactTool(input, authorized);

    case "find_people":

    case "enrich_contact":
      return runtime.executeContactResearch(input, authorized);

    case "export_contacts_to_table":
      return runtime.exportContactsToTable(input, authorized);

    case "create_project":

    case "update_project":
      return runtime.executeProjectTool(input, authorized);

    case "refresh_context":
      return runtime.getContext(input);

    case "find_coworkers": {
      const { query } = searchInputSchema.parse(input.input);
      const [coworkers, people] = await Promise.all([
        runtime.findCoworkers(authorized, query),
        runtime.findTeammates(authorized.turn.workspaceId, query),
      ]);
      return { coworkers, people };
    }

    case "update_memory":
      return runtime.updateMemory(authorized, input.input, input.toolCallId);

    case "save_brand_brain":

    case "save_strategy":

    case "report_update":
      return runtime.saveCmoRecord(authorized, input);

    case "evaluate_with_jev": {
      const parsed = sokoBotEvaluateWithJevInputSchema.parse(input.input);
      let evaluation: Awaited<ReturnType<typeof evaluateWithJevForBot>>;
      try {
        evaluation = await evaluateWithJevForBot(parsed);
      } catch {
        throw new SokoBotRuntimeValidationError(
          "Jev is unavailable right now; judge these yourself.",
        );
      }
      // Jev is overhead like routing: on the turn's total, not billed.
      await prisma.sokoBotTurn.update({
        where: { id: authorized.turn.id },
        data: {
          overheadCostUsdMicros: {
            increment: BigInt(Math.round(evaluation.costUsd * 1_000_000)),
          },
        },
      });
      return evaluation.result;
    }

    case "search_exa": {
      const parsed = sokoBotSearchExaInputSchema.parse(input.input);
      // Each search costs money; this call's own row is already counted.
      const searches = await prisma.sokoBotToolCall.count({
        where: { turnId: authorized.turn.id, capability: "search_exa" },
      });
      if (searches > EXA_SEARCHES_PER_TURN) {
        throw new SokoBotRuntimeValidationError(
          `That was the last Exa search for this turn (${EXA_SEARCHES_PER_TURN}). Work with what you found, or use web_fetch on a page you already know.`,
        );
      }
      let found: Awaited<ReturnType<typeof searchExa>>;
      try {
        found = await searchExa(parsed, {
          userIdentifier: authorized.turn.sokoBotId,
        });
      } catch (error) {
        throw new SokoBotRuntimeValidationError(
          error instanceof ExaUnavailableError
            ? "Exa search is unavailable right now; use web_search instead."
            : "Exa search failed; use web_search instead.",
        );
      }
      const log = new RuntimeEventLog(authorized.turn.id, input.sessionId);
      // Search results are web pages: nothing they say may reach an outward action.
      await log.append(runtimeEvent(WEB_TAINT_EVENT, { source: "search_exa" }));
      // Billed like a model step, so credits and the spend breakdown include it.
      if (found.costUsd > 0) {
        await log.append(
          runtimeEvent("step.completed", {
            modelId: "exa/search",
            usage: { costUsd: found.costUsd },
          }),
        );
      }
      // Said on every result, so Cuso stops before the cap refuses him.
      return { ...found, searchesLeft: EXA_SEARCHES_PER_TURN - searches };
    }
  }
}
