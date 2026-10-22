import { gateway } from "ai";
import {
  recordSandboxAction,
  recordSandboxActionResult,
} from "@/services/soko-bot-sandbox-turn.service";
import { citableSources, fetchWebPage } from "@/soko-bot-runner/local-tools";
import { sokoBotModelRequest } from "./model-policy";
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
  const report = (status: "completed" | "failed", output: unknown) =>
    recordSandboxActionResult(claims, {
      name: input.capability,
      toolCallId: input.toolCallId,
      status,
      output: JSON.stringify(output ?? null).slice(0, 8_000),
      sources: citableSources(input.capability, output),
    }).catch(() => undefined);
  try {
    const output =
      input.capability === "web_fetch"
        ? await fetchWebPage(input.toolInput as { url: string })
        : await searchWeb(
            (input.toolInput as { query: string }).query,
            gateway,
            sokoBotModelRequest({
              role: "agent",
              model: input.model,
              inferenceRegion: input.inferenceRegion,
            }).model,
          );
    await report("completed", output);
    return output;
  } catch (error) {
    await report("failed", {
      error: error instanceof Error ? error.message : "failed",
    });
    throw error;
  }
}
