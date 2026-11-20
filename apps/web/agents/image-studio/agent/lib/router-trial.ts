import { createHash } from "node:crypto";
import { z } from "zod";

export const studioRouterTrialSchema = z.enum(["off", "opus"]).default("off");

export function studioRouterForSession(sessionId: string) {
  const trial = studioRouterTrialSchema.parse(
    process.env.STUDIO_AGENT_ROUTER_TRIAL,
  );
  if (
    trial === "opus" &&
    createHash("sha256").update(sessionId).digest().readUInt8(0) < 128
  ) {
    return {
      model: "anthropic/claude-opus-5.5",
      arm: "router:opus-5.5",
    } as const;
  }
  return {
    model: "anthropic/claude-sonnet-5",
    arm: "router:sonnet-5",
  } as const;
}
