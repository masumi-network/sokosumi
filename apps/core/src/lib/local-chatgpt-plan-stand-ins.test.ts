import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const experimentalEvaluate = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
  experimental_evaluate: experimentalEvaluate,
}));
vi.mock("@/lib/soko-bot/model-calls", () => ({ recordModelCall: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
  experimentalEvaluate.mockRejectedValue(new Error("Jev on the Gateway"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  generateText.mockReset();
});

describe("ChatGPT plan stand-ins", () => {
  it("runs every model on the plan, non-OpenAI ones as the stand-in", async () => {
    const { localChatGptPlanModel } = await import("./local-chatgpt-plan");
    expect(localChatGptPlanModel("google/gemini-3.8-flash")?.modelId).toBe(
      "gpt-6-luna",
    );
    expect(localChatGptPlanModel("anthropic/claude-sonnet-5.5")?.modelId).toBe(
      "gpt-6-luna",
    );
    expect(localChatGptPlanModel("openai/gpt-6.2-sol")?.modelId).toBe(
      "gpt-6.2-sol",
    );
  });

  it("refuses any Gateway request once guarded, and passes the rest through", async () => {
    const send = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", send);
    const { installChatGptPlanGatewayGuard, ChatGptPlanGatewayCallError } =
      await import("./local-chatgpt-plan");
    installChatGptPlanGatewayGuard();
    await expect(
      fetch("https://ai-gateway.vercel.sh/v4/ai/language-model"),
    ).rejects.toBeInstanceOf(ChatGptPlanGatewayCallError);
    await expect(
      fetch(new Request("https://ai-gateway.vercel.sh/v4/ai/embedding-model")),
    ).rejects.toThrow(/nothing was sent/);
    await fetch("https://api.openai.com/v1/responses");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("answers Jev's questions on the plan, labelled, in Jev's shape", async () => {
    generateText.mockResolvedValue({
      output: {
        hire: { probability: 1.4 },
        tone: { choice: "warm", probabilities: { warm: 0.8, cold: -0.1 } },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const { evaluateWithJev } = await import("./soko-bot/jev");
    const { answers, costUsd } = await evaluateWithJev({
      state: { message: "hi" },
      questions: {
        hire: { type: "boolean", instructions: "Asks to hire?" },
        tone: {
          type: "choice",
          instructions: "Tone?",
          criteria: { warm: "Warm", cold: "Cold" },
        },
      },
      timeoutMs: 1_000,
    });
    expect(experimentalEvaluate).not.toHaveBeenCalled();
    expect(generateText.mock.calls[0]?.[0]).toMatchObject({
      telemetry: { functionId: "chatgpt-plan-jev" },
    });
    expect(generateText.mock.calls[0]?.[0].model.modelId).toBe("gpt-6-luna");
    expect(answers.get("hire")).toEqual({ type: "boolean", probability: 1 });
    expect(answers.get("tone")).toEqual({
      type: "choice",
      choice: "warm",
      probabilities: { warm: 0.8, cold: 0 },
    });
    expect(costUsd).toBe(0);
  });

  it("answers the classifier's route questions in the shape it parses", async () => {
    generateText.mockResolvedValue({
      output: {
        route: { choice: "CLARIFY", probabilities: { CLARIFY: 0.9 } },
        aboutMail: { probability: 0.2 },
      },
      usage: {},
    });
    const { routeQuestions } = await import("./soko-bot/classifier");
    const { evaluateOnChatGptPlan } = await import(
      "./local-chatgpt-plan-stand-ins"
    );
    const questions = routeQuestions(false);
    const { answers } = await evaluateOnChatGptPlan({
      state: { message: "x" },
      questions,
    });
    const schema = generateText.mock.calls[0]?.[0].output;
    expect(schema).toBeDefined();
    expect(Object.keys(questions)).toContain("route");
    expect(answers).toEqual({
      route: { choice: "CLARIFY", probabilities: { CLARIFY: 0.9 } },
      aboutMail: { probability: 0.2 },
    });
    expect(experimentalEvaluate).not.toHaveBeenCalled();
  });

  it("embeds in process: free, deterministic, closer for shared wording", async () => {
    const { embedTexts } = await import("./embeddings");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { embeddings, costUsd } = await embedTexts([
      "Put the minting fee in the launch budget",
      "Put the minting fee in your launch budget",
      "Our coffee is roasted every Monday",
    ]);
    const cosine = (a: number[], b: number[]) =>
      a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
    const [a, b, c] = embeddings as [number[], number[], number[]];
    expect(cosine(a, b)).toBeGreaterThan(0.7);
    expect(cosine(a, c)).toBeLessThan(0.2);
    expect(costUsd).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect((await embedTexts(["same text"])).embeddings).toEqual(
      (await embedTexts(["same text"])).embeddings,
    );
  });
});
