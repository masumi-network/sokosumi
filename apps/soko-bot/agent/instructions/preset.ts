import { defineDynamic, defineInstructions } from "eve/instructions";

import { readRuntimeAuth } from "../lib/auth";

/** Extra system guidance carried by the agent preset the control plane chose. */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const auth = readRuntimeAuth(ctx.session.auth.current);
      if (!auth.presetInstructions) return null;
      return defineInstructions({
        role: "system",
        content: `PRESET GUIDANCE (${auth.presetId ?? "custom"}):\n${auth.presetInstructions}`,
      });
    },
  },
});
