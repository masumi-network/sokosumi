"use server";

import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { coreClient } from "@/lib/clients/core.client";

/** Star or unstar an Agent for the signed-in user. Core scopes it to them. */
export async function setAgentStar(
  agentId: string,
  starred: boolean,
): Promise<ActionResultDto<void, { code: "FAILED" }>> {
  try {
    await (starred
      ? coreClient.starAgent(agentId)
      : coreClient.unstarAgent(agentId));
    return toActionResult(ok(undefined));
  } catch (error) {
    console.error("[setAgentStar] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return toActionResult(err({ code: "FAILED" }));
  }
}
