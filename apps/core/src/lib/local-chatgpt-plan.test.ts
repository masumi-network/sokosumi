import { describe, expect, it } from "vitest";
import {
  chatGptPlanRequestBody,
  localChatGptPlanEnabled,
  localChatGptPlanModel,
} from "./local-chatgpt-plan";

describe("local ChatGPT plan", () => {
  it("is off unless the flag is set", () => {
    expect(localChatGptPlanEnabled({})).toBe(false);
    expect(localChatGptPlanEnabled({ SOKO_BOT_LOCAL_CHATGPT_PLAN: "1" })).toBe(
      true,
    );
  });

  it("refuses to run on Vercel or in production", () => {
    expect(() =>
      localChatGptPlanEnabled({
        SOKO_BOT_LOCAL_CHATGPT_PLAN: "1",
        VERCEL: "1",
      }),
    ).toThrow(/local only/);
    expect(() =>
      localChatGptPlanEnabled({
        SOKO_BOT_LOCAL_CHATGPT_PLAN: "true",
        NODE_ENV: "production",
      }),
    ).toThrow(/local only/);
  });

  it("keeps the Gateway for non-OpenAI models and when off", () => {
    expect(localChatGptPlanModel("google/gemini-3.8-flash")).toBeNull();
    expect(localChatGptPlanModel("openai/gpt-6-luna")).toBeNull();
  });

  it("sends a stateless streamed body without refused fields", () => {
    const body = chatGptPlanRequestBody({
      model: "gpt-6-luna",
      store: true,
      max_output_tokens: 4000,
      temperature: 0.2,
      prompt_cache_retention: "24h",
      prompt_cache_options: { ttl: "12h" },
      prompt_cache_key: "cmo-v24:0123456789abcdef",
      reasoning: { summary: "auto" },
      input: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(body).toEqual({
      model: "gpt-6-luna",
      store: false,
      stream: true,
      reasoning: { summary: "auto" },
      input: [
        { role: "developer", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    });
  });
});
