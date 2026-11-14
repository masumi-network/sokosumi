import { gateway } from "ai";
import {
  recordSandboxAction,
  recordSandboxActionResult,
} from "@/services/soko-bot-sandbox-turn.service";
import { citableSources, fetchWebPage } from "@/soko-bot-runner/local-tools";
import { runWebEvidenceTool } from "@/soko-bot-runner/web-evidence-tool";
import { gatewayCallUsage } from "./gateway-cost";
import { sokoBotModelRequest } from "./model-policy";
import { RuntimeEventLog, runtimeEvent } from "./turn-loop";
import { searchWeb } from "./web-search";

/** How long a recorded web call stays attributable to its turn. */
const CLAIMS_TTL_MS = 10 * 60_000;

/**
 * Runs a read-only web tool for a turn without a sandbox, exactly as the
 * sandbox runner would: the same search and fetch code, and the same audit
 * row, web-taint mark and citable sources through the sandbox service.
 */
export async function runInProcessWebTool(input: {
  sessionId: string;
  turnId: string;
  capability: "web_search" | "web_fetch";
  toolCallId: string;
  toolInput: unknown;
  model: string;
  inferenceRegion?: "eu" | "us";
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
  return runWebEvidenceTool({
    run: () =>
      input.capability === "web_fetch"
        ? fetchWebPage(input.toolInput as { url: string })
        : searchWeb(
            (input.toolInput as { query: string }).query,
            gateway,
            sokoBotModelRequest({
              role: "agent",
              model: input.model,
              inferenceRegion: input.inferenceRegion,
            }).model,
            // Billed and broken down as search, not as the agent's own model.
            (result) =>
              new RuntimeEventLog(input.turnId, input.sessionId).append(
                runtimeEvent("step.completed", {
                  modelId: "web_search",
                  usage: gatewayCallUsage(result),
                }),
              ),
          ),
    sources: (output) => citableSources(input.capability, output),
    report: (status, output, sources) =>
      recordSandboxActionResult(claims, {
        name: input.capability,
        toolCallId: input.toolCallId,
        status,
        output,
        sources,
      }),
  });
}
