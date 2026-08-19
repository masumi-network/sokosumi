import { sokoBotRuntimeContextSchema } from "@sokosumi/soko-bot";
import { defineHook } from "eve/hooks";

import { readRuntimeAuth } from "../lib/auth";
import { callCore } from "../lib/core";

export default defineHook({
  events: {
    async "turn.started"(_event, ctx) {
      // A provider-loss replacement can keep Eve's durable sandbox key while
      // losing files, and that recovery path does not rerun `onSession`.
      // Eve runs hooks before dynamic resolvers, so every turn recreates the
      // Core-owned memory file before model work starts.
      const auth = readRuntimeAuth(ctx.session.auth.current);
      const context = await callCore(
        "/v1/internal/soko-bot/context",
        auth,
        ctx.session.id,
        {},
        sokoBotRuntimeContextSchema,
      );
      const sandbox = await ctx.getSandbox();
      await sandbox.run({ command: "mkdir -p scratch" });
      await sandbox.writeTextFile({
        path: "MEMORY.md",
        content: context.packet.memory.markdown,
      });
    },
  },
});
