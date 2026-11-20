import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("ai", async () => ({
  ...(await vi.importActual<typeof import("ai")>("ai")),
  generateText: generateTextMock,
}));
vi.mock("@/lib/image-studio/studio-brand", () => ({
  loadStudioBrand: vi.fn().mockResolvedValue({}),
  studioBrandPromptBlock: () => "Brand Brain:\nWe roast coffee in Zurich.",
}));
vi.mock("@/lib/soko-bot/model-policy", () => ({
  sokoBotModelRequest: () => ({ model: "test-model" }),
}));

import { writeTalkingVideoScripts } from "./talking-video-scripts.service";

const GOOD = {
  hook: "Your coffee is stale before you open it.",
  script:
    "Your coffee is stale before you open it. We roast every bag in Zurich the week it ships. Order yours today.",
};

beforeEach(() => {
  generateTextMock.mockReset();
});

describe("writeTalkingVideoScripts", () => {
  it("sends the brand and the topic as source material and returns the scripts", async () => {
    generateTextMock.mockResolvedValue({ output: { scripts: [GOOD] } });

    const scripts = await writeTalkingVideoScripts({
      projectId: "project-1",
      topic: "the new espresso roast",
      languageCode: "de",
    });

    expect(scripts).toEqual([GOOD]);
    expect(JSON.parse(generateTextMock.mock.calls[0]![0].prompt)).toEqual({
      language: "de",
      topic: "the new espresso roast",
      brand: "Brand Brain:\nWe roast coffee in Zurich.",
    });
  });

  it("drops a script that speaks as a customer, or is too short or too long", async () => {
    generateTextMock.mockResolvedValue({
      output: {
        scripts: [
          GOOD,
          {
            hook: "I tried it.",
            script: `I bought this coffee. ${GOOD.script}`,
          },
          { hook: "Hi.", script: "Too short." },
          { hook: "Long.", script: "word ".repeat(200) },
        ],
      },
    });

    const scripts = await writeTalkingVideoScripts({
      projectId: "project-1",
      languageCode: "en",
    });

    expect(scripts).toEqual([GOOD]);
  });
});
