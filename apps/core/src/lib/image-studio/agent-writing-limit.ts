import { tooManyRequests } from "@/helpers/error";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import type { UserAuthenticationContext } from "@/middleware/auth";

/**
 * Captions and talking-video scripts are model calls on the shared AI Gateway
 * budget and charge no credits, so an agent in a loop could drain that budget
 * for everyone (SOKD-394). A person at the keyboard is never counted.
 */
export const AGENT_WRITING_PER_HOUR = 60;

export async function limitAgentWriting(
  authContext: UserAuthenticationContext,
  workspaceId: string,
): Promise<void> {
  if (authContext.authenticationMethod === "session") return;
  const count = await incrementRedisRateLimit(
    `studio:agent-writing:${workspaceId}`,
    60 * 60,
  );
  if (typeof count === "number" && count > AGENT_WRITING_PER_HOUR) {
    throw tooManyRequests(
      `An agent can write ${AGENT_WRITING_PER_HOUR} captions or script sets per workspace per hour. Try again later.`,
    );
  }
}
