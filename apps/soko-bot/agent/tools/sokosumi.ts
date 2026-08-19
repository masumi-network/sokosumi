import {
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
  sokoBotRuntimeToolResultSchema,
  sokoBotScratchReadInputSchema,
  sokoBotScratchWriteInputSchema,
} from "@sokosumi/soko-bot";
import { type DynamicToolSet, defineDynamic, defineTool } from "eve/tools";
import { never } from "eve/tools/approval";

import { readRuntimeAuth } from "../lib/auth";
import { callCore } from "../lib/core";

function coreTool(capability: SokoBotCapability) {
  return defineTool({
    description: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
    inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS[capability],
    approval: never(),
    async execute(input, toolCtx) {
      const auth = readRuntimeAuth(toolCtx.session.auth.current);
      const result = await callCore(
        "/v1/internal/soko-bot/tools/execute",
        auth,
        toolCtx.session.id,
        {
          capability,
          toolCallId: toolCtx.callId,
          input,
        },
        sokoBotRuntimeToolResultSchema,
        toolCtx.abortSignal,
      );
      if (
        (capability === "read_memory" || capability === "update_memory") &&
        result &&
        typeof result === "object" &&
        "markdown" in result &&
        typeof result.markdown === "string"
      ) {
        const sandbox = await toolCtx.getSandbox();
        await sandbox.writeTextFile({
          path: "MEMORY.md",
          content: result.markdown,
        });
      }
      return result;
    },
  });
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const auth = readRuntimeAuth(ctx.session.auth.current);
      const tools: Record<string, unknown> = {};
      for (const capability of auth.capabilities) {
        if (capability === "scratch_read") {
          tools[capability] = defineTool({
            description: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
            inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS[capability],
            approval: never(),
            async execute(input, toolCtx) {
              const parsed = sokoBotScratchReadInputSchema.parse(input);
              const sandbox = await toolCtx.getSandbox();
              return {
                content: await sandbox.readTextFile({
                  path: `scratch/${parsed.path}`,
                }),
              };
            },
          });
        } else if (capability === "scratch_write") {
          tools[capability] = defineTool({
            description: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
            inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS[capability],
            approval: never(),
            async execute(input, toolCtx) {
              const parsed = sokoBotScratchWriteInputSchema.parse(input);
              const sandbox = await toolCtx.getSandbox();
              await sandbox.run({ command: "mkdir -p scratch" });
              await sandbox.writeTextFile({
                path: `scratch/${parsed.path}`,
                content: parsed.content,
              });
              return {
                written: true,
                bytes: Buffer.byteLength(parsed.content),
              };
            },
          });
        } else if (capability === "scratch_list") {
          tools[capability] = defineTool({
            description: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
            inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS[capability],
            approval: never(),
            async execute(_input, toolCtx) {
              const sandbox = await toolCtx.getSandbox();
              const result = await sandbox.run({
                command:
                  "find scratch -maxdepth 2 -type f -print 2>/dev/null | head -100",
              });
              return { files: result.stdout.split("\n").filter(Boolean) };
            },
          });
        } else {
          tools[capability] = coreTool(capability);
        }
      }
      // Eve's DynamicToolSet erases per-tool input generics. Entries above are
      // all produced by defineTool; keep precise schema types until this seam.
      return tools as DynamicToolSet;
    },
  },
});
