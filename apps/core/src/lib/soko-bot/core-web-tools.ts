import prisma from "@/lib/db/prisma";
import { isEvalWorkspaceNow } from "@/lib/evals/eval-guard";
import { runInEvalWorld } from "@/lib/evals/eval-world-context";
import {
  recordSandboxAction,
  recordSandboxActionResult,
} from "@/services/soko-bot-sandbox-turn.service";
import { citableSources, fetchWebPage } from "@/soko-bot-runner/local-tools";
import { type ExaSearchResult, ExaUnavailableError, searchExa } from "./exa";
import { recordModelCall } from "./model-calls";
import { RuntimeEventLog, runtimeEvent } from "./turn-loop";

/** How long a recorded web call stays attributable to its turn. */
const CLAIMS_TTL_MS = 10 * 60_000;

const WEB_SEARCH_RESULTS = 5;

/**
 * One search straight against Exa. It used to be a whole call of the turn's
 * own model (Sol on a strong turn) that only forced the Gateway's search tool.
 */
async function searchTheWeb(input: {
  sessionId: string;
  turnId: string;
  toolInput: unknown;
}): Promise<{ query: string; results: ExaSearchResult["results"] }> {
  const { query } = input.toolInput as { query: string };
  let found: ExaSearchResult;
  try {
    found = await searchExa({ query, numResults: WEB_SEARCH_RESULTS });
  } catch (error) {
    throw new Error(
      error instanceof ExaUnavailableError
        ? "Web search is unavailable right now; use web_fetch on a page you know, or try again later."
        : "Web search failed; try other words, or use web_fetch on a page you know.",
    );
  }
  if (found.costUsd > 0) {
    // Billed like a model step, so credits and the spend breakdown include it.
    await new RuntimeEventLog(input.turnId, input.sessionId).append(
      runtimeEvent("step.completed", {
        modelId: "exa/search",
        usage: { costUsd: found.costUsd },
      }),
    );
    await recordModelCall({
      turnId: input.turnId,
      role: "search",
      label: "web_search",
      requestedModel: "exa/search",
      costUsd: found.costUsd,
    });
  }
  return { query, results: found.results };
}

/** The turn's workspace when it is an eval lane's, else null. */
async function evalTurnWorkspace(turnId: string): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { workspaceId: true },
  });
  return turn && (await isEvalWorkspaceNow(turn.workspaceId))
    ? turn.workspaceId
    : null;
}

/** An eval lane's page: from its fixed web, never the network. */
async function evalWebFetchPage(toolInput: unknown) {
  const { evalWebFetch } = await import("@/services/evals/eval-web-world");
  return evalWebFetch(toolInput as { url: string; maxChars?: number });
}

/**
 * Runs a read-only web tool in Core: every web search, and a fetch for a turn
 * without a sandbox. It writes the same audit row, web-taint mark and citable
 * sources through the sandbox service as the runner's own tools.
 */
export async function runCoreWebTool(input: {
  sessionId: string;
  turnId: string;
  capability: "web_search" | "web_fetch";
  toolCallId: string;
  toolInput: unknown;
}): Promise<unknown> {
  const claims = {
    sessionId: input.sessionId,
    turnId: input.turnId,
    expiresAt: Date.now() + CLAIMS_TTL_MS,
  };
  await recordSandboxAction(claims, {
    name: input.capability,
    toolCallId: input.toolCallId,
    toolInput: input.toolInput,
  });
  const report = (status: "completed" | "failed", output: unknown) =>
    recordSandboxActionResult(claims, {
      name: input.capability,
      toolCallId: input.toolCallId,
      status,
      output: JSON.stringify(output ?? null).slice(0, 8_000),
      sources: citableSources(input.capability, output),
    }).catch(() => undefined);
  try {
    const evalWorkspace = await evalTurnWorkspace(input.turnId);
    const run = (): Promise<unknown> =>
      input.capability === "web_fetch"
        ? evalWorkspace
          ? evalWebFetchPage(input.toolInput)
          : fetchWebPage(input.toolInput as { url: string })
        : searchTheWeb(input);
    const output = evalWorkspace
      ? await runInEvalWorld(evalWorkspace, run)
      : await run();
    await report("completed", output);
    return output;
  } catch (error) {
    await report("failed", {
      error: error instanceof Error ? error.message : "failed",
    });
    throw error;
  }
}
