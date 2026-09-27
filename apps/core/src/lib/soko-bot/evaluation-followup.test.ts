import { generateText, stepCountIs, tool, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it } from "vitest";
import { z } from "zod";

it("measures the real SDK follow-up with a sanitized task observation", async () => {
  const sizes: number[] = [];
  const parts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content:
        sizes.length === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "read",
                toolName: "get_task_status",
                input: JSON.stringify({ taskId: "synthetic-task" }),
              },
            ]
          : [{ type: "text", text: "Observed draft" }],
      finishReason: {
        unified: sizes.length === 1 ? "tool-calls" : "stop",
        raw: "stop",
      },
      warnings: [],
      usage: {
        inputTokens: {
          total: 100,
          noCache: 100,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
    }),
  });
  await generateText({
    model: wrapLanguageModel({
      model,
      middleware: {
        async wrapGenerate({ params, doGenerate }) {
          sizes.push(Buffer.byteLength(JSON.stringify(params)) + 512);
          parts.push(
            params.prompt.map((m) => ({
              role: m.role,
              bytes: Buffer.byteLength(JSON.stringify(m)),
              types:
                typeof m.content === "string"
                  ? ["text"]
                  : m.content.map((p) => p.type),
            })),
          );
          return doGenerate();
        },
      },
    }),
    system: "x".repeat(19000),
    prompt: "Archive only the synthetic task.",
    maxRetries: 0,
    stopWhen: stepCountIs(3),
    tools: {
      get_task_status: tool({
        inputSchema: z.object({ taskId: z.string() }),
        execute: async () => ({
          evidenceToolCallId: "read",
          result: {
            id: "synthetic-task",
            name: "Synthetic archive fixture",
            status: "DRAFT",
            ownerId: "synthetic-owner",
            updatedAt: "2026-09-27T01:43:38.299Z",
            archivedAt: null,
            assignee: null,
            project: null,
            files: [],
            links: [],
            description: "Synthetic private fixture only.",
            events: [{ id: "synthetic-event", status: "DRAFT", comment: null }],
            fulfillment: {
              state: "UNKNOWN",
              blockerKind: "NO_CURRENT_AUTHORIZED_ASSESSMENT",
              evidenceIds: [],
              remainingSteps: [],
              criteriaResults: [],
              acceptanceCriteria: [],
            },
          },
        }),
      }),
    },
  });
  process.stdout.write(JSON.stringify({ sizes, parts }) + "\n");
  expect(sizes).toHaveLength(2);
  expect(sizes[1]).toBeLessThan(32768);
});
