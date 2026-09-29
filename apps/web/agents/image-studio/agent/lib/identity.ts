import crypto from "node:crypto";

import type { AgentIdentity } from "./core";

/**
 * The acting user and project for this turn.
 *
 * Read from session auth, which the channel established when it verified the
 * caller's token — never from a tool argument. This is what makes it
 * impossible to talk the agent into working on another project: the project is
 * not something the model can say.
 */
export function identityFrom(ctx: {
  session: {
    auth: {
      current?: {
        attributes?: Record<string, unknown> | null;
      } | null;
    };
  };
}): AgentIdentity {
  const attributes = ctx.session.auth.current?.attributes ?? {};
  const userId = attributes.sokosumiUserId;
  const projectId = attributes.sokosumiProjectId;
  if (typeof userId !== "string" || typeof projectId !== "string") {
    throw new Error("This conversation is not bound to a Sokosumi project.");
  }
  return { userId, projectId };
}

/**
 * A replay guard for one tool call.
 *
 * eve's durable runtime can retry a step, and a retry that reached Core would
 * otherwise buy a second image. Deriving the key from the turn and the call
 * means the retry presents the same key, and Core returns the original job.
 */
export function idempotencyKeyFor(
  ctx: {
    session: { id: string; turn: { id: string } };
  },
  discriminator: string,
): string {
  // Hashed because the discriminator carries the prompt, which may run to
  // thousands of characters, while Core caps the key at 200. An unbounded key
  // turned a long prompt into a 400 instead of a generation.
  const digest = crypto
    .createHash("sha256")
    .update(discriminator)
    .digest("base64url");
  return `eve:${ctx.session.id}:${ctx.session.turn.id}:${digest}`;
}
