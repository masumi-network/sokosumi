import { defineHook } from "eve/hooks";

import { authorizeSession } from "../lib/core";
import { identityFrom } from "../lib/identity";

/**
 * Bind a new session to its project the moment eve creates it.
 *
 * The channel policy requires a session to be bound before it will allow any
 * operation on it, and binding here — server side, from the identity the
 * policy just established — means the binding exists before the id could
 * reach anyone else. It does not depend on the browser remembering to call
 * back, which is what made the previous arrangement both racy and lossy.
 *
 * `authorizeSession` claims an unseen id and verifies an existing one, so this
 * is the same call the policy makes; running it here is what makes the first
 * one a claim.
 */
export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      try {
        const identity = identityFrom(ctx);
        const bound = await authorizeSession(identity, ctx.session.id);
        if (!bound) {
          console.warn("[image-studio] session could not be bound", {
            sessionId: ctx.session.id,
          });
        }
      } catch (error) {
        // The channel policy re-runs this on the next request, so a transient
        // failure here costs one round trip, not the conversation.
        console.warn("[image-studio] session binding failed", {
          sessionId: ctx.session.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  },
});
