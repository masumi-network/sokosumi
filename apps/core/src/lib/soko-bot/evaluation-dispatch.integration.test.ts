import { randomUUID } from "node:crypto";
import {
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import { generateText, stepCountIs, tool, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

const config = vi.hoisted(() => ({ raw: "" }));
const EVALUATION_DATABASE_URL =
  "postgresql://patrick@127.0.0.1:55439/soko_reliability_evaluation";
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    NETWORK: "Preprod",
    SOKO_BOT_EVALUATION_ALLOWANCE: config.raw,
    SOKO_BOT_PROACTIVE_PAUSED: true,
    SOKO_BOT_TURN_JUDGE_ENABLED: false,
  }),
}));
vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const url = process.env.LOCAL_EVALUATION_DATABASE_URL;
  if (url !== EVALUATION_DATABASE_URL)
    throw new Error(
      `Explicit disposable evaluation database required: set LOCAL_EVALUATION_DATABASE_URL=${EVALUATION_DATABASE_URL}`,
    );
  return { default: createPrismaClient(url) };
});
describe.skipIf(!process.env.LOCAL_EVALUATION_DATABASE_URL)(
  "durable preview dispatch fence",
  () => {
    let db: typeof import("@/lib/db/prisma").default;
    let fence: typeof import("./evaluation-dispatch");
    const owner = randomUUID(),
      bot = randomUUID(),
      workspace = randomUUID(),
      task = randomUUID();
    const binding = {
      reservationId: randomUUID(),
      userId: owner,
      botId: bot,
      branch: "fixture",
      sourceSha: "a".repeat(40),
      taskIds: [task],
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const actor = {
      userId: owner,
      sokoBotId: bot,
      clientTurnId: "fixture-turn",
      source: "CHAT",
    };
    const model = "google/gemini-3.6-flash";
    const request = {
      actor,
      key: "fixture-turn/agent/0",
      model,
      role: "agent",
      inputBytes: 23000,
    };
    beforeAll(async () => {
      db = (await import("@/lib/db/prisma")).default;
      fence = await import("./evaluation-dispatch");
      await db.user.create({
        data: {
          id: owner,
          name: "Synthetic evaluation",
          email: `evaluation-${owner}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.workspace.create({ data: { id: workspace, userId: owner } });
      await db.sokoBot.create({
        data: { id: bot, userId: owner, workspaceId: workspace },
      });
    });
    beforeEach(async () => {
      await db.sokoBotEvaluationAllowance.deleteMany();
      config.raw = JSON.stringify(binding);
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("VERCEL_GIT_COMMIT_REF", "fixture");
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", binding.sourceSha);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: model,
                    pricing: {
                      regional: {
                        eu: { input: "0.000000825", output: "0.000004125" },
                      },
                    },
                  },
                ],
              }),
            ),
        ),
      );
    });
    afterAll(async () => {
      await db.sokoBotEvaluationAllowance.deleteMany();
      await db.user.delete({ where: { id: owner } });
      await db.$disconnect();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    it("commits reservation before dispatch; concurrent reservations cannot both spend", async () => {
      const results = await Promise.allSettled([
        fence.reserveEvaluationCall(request),
        fence.reserveEvaluationCall({ ...request, key: "other/agent/0" }),
      ]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const ledger = await db.sokoBotEvaluationAllowance.findUniqueOrThrow({
        where: { id: "preview-evaluation" },
      });
      expect(ledger.calls).toHaveLength(1);
    });
    it("crash after reservation remains blocked across connection restart", async () => {
      await fence.reserveEvaluationCall(request);
      await db.$disconnect();
      await db.$connect();
      await expect(
        fence.reserveEvaluationCall({ ...request, key: "new" }),
      ).rejects.toThrow("blocked");
    });
    it("settled replay, changed allocation and exhausted ten-call partition cannot dispatch", async () => {
      for (let i = 0; i < 10; i++) {
        await fence.reserveEvaluationCall({ ...request, key: `call${i}` });
        await fence.settleEvaluationCall(
          `call${i}`,
          0.001,
          { region: "eu" },
          false,
        );
      }
      await expect(
        fence.reserveEvaluationCall({ ...request, key: "call0" }),
      ).rejects.toThrow("replay");
      await expect(
        fence.reserveEvaluationCall({ ...request, key: "eleventh" }),
      ).rejects.toThrow("exhausted");
      config.raw = JSON.stringify({ ...binding, reservationId: randomUUID() });
      await expect(fence.reserveEvaluationCall(request)).rejects.toThrow(
        "blocked",
      );
    });
    it.each(["user", "bot", "source", "branch", "production", "revision"])(
      "rejects unauthorized %s before reservation",
      async (kind) => {
        if (kind === "branch") vi.stubEnv("VERCEL_GIT_COMMIT_REF", "other");
        if (kind === "production") vi.stubEnv("VERCEL_ENV", "production");
        if (kind === "revision")
          vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b".repeat(40));
        const changed = {
          ...actor,
          ...(kind === "user"
            ? { userId: "other" }
            : kind === "bot"
              ? { sokoBotId: randomUUID() }
              : kind === "source"
                ? { source: "SCHEDULE" }
                : {}),
        };
        await expect(
          fence.reserveEvaluationCall({ ...request, actor: changed }),
        ).rejects.toThrow();
        expect(await db.sokoBotEvaluationAllowance.count()).toBe(0);
      },
    );
    it("rejects excessive input and unscoped SDK use before dispatch", async () => {
      await expect(
        fence.reserveEvaluationCall({ ...request, inputBytes: 32769 }),
      ).rejects.toThrow("envelope");
      let dispatched = false;
      const mock = new MockLanguageModelV3({
        modelId: model,
        doGenerate: async () => {
          dispatched = true;
          throw new Error("unexpected");
        },
      });
      await expect(
        generateText({
          model: wrapLanguageModel({
            model: mock,
            middleware: fence.evaluationMiddleware(model, "judge"),
          }),
          prompt: "synthetic",
          maxRetries: 0,
        }),
      ).rejects.toThrow("Unscoped");
      expect(dispatched).toBe(false);
      expect(await db.sokoBotEvaluationAllowance.count()).toBe(0);
    });
    it("filters model context to fixture records only", () => {
      const result = fence.evaluationContext({
        trigger: { source: "CHAT" },
        tasks: [
          { id: task, name: "synthetic" },
          { id: "unrelated", name: "private" },
        ],
        memory: { markdown: "private" },
        projects: [{ name: "private" }],
      });
      expect(JSON.stringify(result)).not.toContain("private");
      expect(
        fence.evaluationClassifierContext({
          taskIds: [task, "other"],
          projectIds: ["private"],
          agentIds: [],
          coworkerIds: [],
          jobIds: [],
        }),
      ).toMatchObject({ taskIds: [task], projectIds: [] });
    });
    it("allows only synthetic archive/read/approval targets", () => {
      expect(() =>
        fence.assertEvaluationTool("archive_task", { taskId: task }),
      ).not.toThrow();
      expect(() =>
        fence.assertEvaluationTool("archive_task", { taskId: randomUUID() }),
      ).toThrow();
      expect(() =>
        fence.assertEvaluationTool("post_chat", { taskId: task }),
      ).toThrow();
      expect(() =>
        fence.assertEvaluationTool("request_user_decision", {
          toolName: "archive_task",
          proposal: { taskId: task },
        }),
      ).not.toThrow();
    });
    async function dispatch(mode = "ok", role = "agent") {
      let calls = 0;
      const mock = new MockLanguageModelV3({
        modelId: model,
        doGenerate: async (options) => {
          calls++;
          expect(options.maxOutputTokens).toBe(2048);
          expect(
            (
              await db.sokoBotEvaluationAllowance.findUniqueOrThrow({
                where: { id: "preview-evaluation" },
              })
            ).calls,
          ).toMatchObject([{ state: "RESERVED" }]);
          if (mode === "transport") throw new Error("uncertain transport");
          return {
            content: [{ type: "text", text: "synthetic" }],
            finishReason: { unified: "stop", raw: "stop" },
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
            providerMetadata:
              mode === "missing"
                ? undefined
                : {
                    gateway: {
                      cost:
                        mode === "cost"
                          ? ".13"
                          : mode === "blank"
                            ? " "
                            : ".001",
                      routing: {
                        finalProvider: "vertex",
                        modelAttempts: [
                          {
                            providerAttempts: [
                              {
                                provider: "vertex",
                                inferenceEndpoint: {
                                  geoRegion: mode === "region" ? "us" : "eu",
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
          };
        },
      });
      const run = () =>
        generateText({
          model: wrapLanguageModel({
            model: mock,
            middleware: fence.evaluationMiddleware(model, role),
          }),
          prompt: "Synthetic",
          maxRetries: 0,
          providerOptions: {
            gateway: {
              inferenceRegion: { scope: "zone", geoRegion: "eu" },
              only: ["vertex"],
            },
          },
        });
      return {
        run: () => fence.withEvaluationActor(actor, run),
        count: () => calls,
      };
    }
    it.each(["selector", "agent", "judge"])(
      "%s SDK receives capped output and durable verified cost before returning",
      async (role) => {
        const test = await dispatch("ok", role);
        await test.run();
        expect(test.count()).toBe(1);
        expect(
          await fence.evaluationEvidence(owner, bot, actor.clientTurnId),
        ).toMatchObject({
          maxCalls: 10,
          maxUsd: 1.2,
          frozen: false,
          calls: [{ state: "SETTLED", costUsd: 0.001 }],
        });
        expect(
          await fence.evaluationEvidence("other", bot, actor.clientTurnId),
        ).toBeNull();
      },
    );
    it("rejects unknown routing before the SDK executes a consequential tool", async () => {
      let executed = 0;
      const mock = new MockLanguageModelV3({
        modelId: model,
        doGenerate: async () => ({
          content: [
            {
              type: "tool-call",
              toolCallId: "archive",
              toolName: "archive_task",
              input: JSON.stringify({ taskId: task }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
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
          providerMetadata: { gateway: { cost: ".001" } },
        }),
      });
      await expect(
        fence.withEvaluationActor(actor, () =>
          generateText({
            model: wrapLanguageModel({
              model: mock,
              middleware: fence.evaluationMiddleware(model, "agent"),
            }),
            prompt: "Archive synthetic fixture",
            maxRetries: 0,
            providerOptions: {
              gateway: {
                inferenceRegion: { scope: "zone", geoRegion: "eu" },
                only: ["vertex"],
              },
            },
            tools: {
              archive_task: tool({
                inputSchema: z.object({ taskId: z.string() }),
                execute: async () => {
                  executed++;
                  return { ok: true };
                },
              }),
            },
          }),
        ),
      ).rejects.toThrow("unverified");
      expect(executed).toBe(0);
      expect(
        await fence.evaluationEvidence(owner, bot, actor.clientTurnId),
      ).toMatchObject({ frozen: true, calls: [{ state: "UNCERTAIN" }] });
    });
    it.each(["ok", "oversized", "tool-error", "reasoning"])(
      "keeps multi-step observations within the same envelope: %s",
      async (mode) => {
        const oversized = mode === "oversized";
        const failedRead = mode === "tool-error";
        let dispatches = 0;
        const observedSizes: number[] = [];
        const metadata = {
          gateway: {
            cost: ".001",
            routing: {
              finalProvider: "vertex",
              modelAttempts: [
                {
                  providerAttempts: [
                    {
                      provider: "vertex",
                      inferenceEndpoint: { geoRegion: "eu" },
                    },
                  ],
                },
              ],
            },
          },
        };
        const readResult = {
          evidenceToolCallId: "read",
          result: {
            id: task,
            status: "DRAFT",
            updatedAt: "2026-09-27T01:43:38.299Z",
            archivedAt: null,
            ownerId: owner,
            description: oversized ? "x".repeat(33000) : "Synthetic fixture",
            events: [],
            files: [],
            links: [],
          },
        };
        const receipt = {
          taskId: task,
          disposition: "COMMITTED",
          verification: "VERIFIED",
          receiptId: "synthetic-receipt",
        };
        const mock = new MockLanguageModelV3({
          modelId: model,
          doGenerate: async (options) => {
            dispatches++;
            expect(options.maxOutputTokens).toBe(2048);
            const reserved = await fence.evaluationEvidence(
              owner,
              bot,
              actor.clientTurnId,
            );
            expect(reserved?.calls).toHaveLength(dispatches);
            expect(reserved?.calls.at(-1)?.state).toBe("RESERVED");
            expect(
              reserved?.calls
                .slice(0, -1)
                .every((call) => call.state === "SETTLED"),
            ).toBe(true);
            observedSizes.push(
              Buffer.byteLength(JSON.stringify(options)) + 512,
            );
            if (dispatches > 1) {
              const prompt = JSON.stringify(options.prompt);
              expect(prompt).toContain("Synthetic archive request");
              expect(prompt).toContain("OPERATING INSTRUCTIONS");
              expect(prompt).toContain(
                failedRead
                  ? "Synthetic read denied"
                  : "2026-09-27T01:43:38.299Z",
              );
              expect(prompt).not.toContain("opaque-signature");
              expect(prompt).not.toContain("UNSUPPORTED SUCCESS CLAIM");
              expect(prompt).not.toContain("PRIVATE REASONING");
              if (dispatches === 3)
                expect(prompt).toContain("synthetic-receipt");
            }
            return {
              content:
                dispatches === 1 || (!failedRead && dispatches < 3)
                  ? [
                      {
                        type: "tool-call",
                        toolCallId: dispatches === 1 ? "read" : "archive",
                        toolName:
                          dispatches === 1 ? "get_task_status" : "archive_task",
                        input: JSON.stringify({
                          taskId: task,
                          ...(dispatches === 2
                            ? { expectedUpdatedAt: "2026-09-27T01:43:38.299Z" }
                            : {}),
                        }),
                        providerMetadata: {
                          google: {
                            thoughtSignature: "opaque-signature".repeat(1600),
                          },
                        },
                      },
                      { type: "text", text: "UNSUPPORTED SUCCESS CLAIM" },
                      ...(mode === "reasoning"
                        ? [
                            {
                              type: "reasoning" as const,
                              text: "PRIVATE REASONING",
                            },
                          ]
                        : []),
                    ]
                  : [
                      {
                        type: "text",
                        text: '{"kind":"REPORT","observationToolCallIds":["read"]}',
                      },
                    ],
              finishReason: {
                unified:
                  dispatches === 1 || (!failedRead && dispatches < 3)
                    ? "tool-calls"
                    : "stop",
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
              providerMetadata: metadata,
            };
          },
        });
        const run = () =>
          fence.withEvaluationActor(actor, () =>
            generateText({
              model: wrapLanguageModel({
                model: mock,
                middleware: fence.evaluationMiddleware(model, "agent"),
              }),
              system: "OPERATING INSTRUCTIONS\n" + "x".repeat(19000),
              prompt: "Synthetic archive request",
              prepareStep: fence.prepareEvaluationStep,
              stopWhen: stepCountIs(3),
              maxRetries: 0,
              providerOptions: {
                gateway: {
                  inferenceRegion: { scope: "zone", geoRegion: "eu" },
                  only: ["vertex"],
                },
              },
              tools: {
                get_task_status: tool({
                  description: SOKO_BOT_TOOL_DESCRIPTIONS.get_task_status,
                  inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS.get_task_status,
                  execute: async () => {
                    if (failedRead) throw new Error("Synthetic read denied");
                    return readResult;
                  },
                }),
                archive_task: tool({
                  description: SOKO_BOT_TOOL_DESCRIPTIONS.archive_task,
                  inputSchema: SOKO_BOT_TOOL_INPUT_SCHEMAS.archive_task,
                  execute: async () => receipt,
                }),
              },
            }),
          );
        if (oversized) {
          await expect(run()).rejects.toThrow("input bytes");
          expect(dispatches).toBe(1);
        } else {
          await run();
          expect(dispatches).toBe(failedRead ? 2 : 3);
        }
        const evidence = await fence.evaluationEvidence(
          owner,
          bot,
          actor.clientTurnId,
        );
        expect(evidence?.calls).toHaveLength(dispatches);
        expect(evidence?.calls.every((call) => call.state === "SETTLED")).toBe(
          true,
        );
        expect(observedSizes.every((size) => size <= 32768)).toBe(true);
      },
    );
    it.each(["transport", "missing", "cost", "blank", "region"])(
      "uncertain %s blocks subsequent dispatch durably",
      async (mode) => {
        const test = await dispatch(mode);
        await expect(test.run()).rejects.toThrow();
        expect(test.count()).toBe(1);
        const next = await dispatch();
        await expect(next.run()).rejects.toThrow("blocked");
        expect(next.count()).toBe(0);
      },
    );
  },
);
