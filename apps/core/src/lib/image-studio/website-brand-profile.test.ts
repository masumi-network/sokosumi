import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generateText,
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    AI_GATEWAY_API_KEY: "test",
  }),
}));
vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({ set: mocks.redisSet }),
}));

import { suggestWebsiteBrandProfile } from "./website-brand-profile";

const source = "Brew at your own pace. Made for home coffee enthusiasts.";

describe("Studio website brand profile suggestions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.redisSet.mockResolvedValue("OK");
  });

  it("keeps only suggestions with evidence quoted from the website", async () => {
    mocks.generateText.mockResolvedValue({
      output: {
        tone: { value: "Warm and relaxed", evidence: "Brew at your own pace." },
        audience: [
          {
            value: "Home coffee enthusiasts",
            evidence: "Made for home coffee enthusiasts.",
          },
          { value: "Cafe owners", evidence: "Made for commercial cafes." },
        ],
      },
    });
    await expect(
      suggestWebsiteBrandProfile("workspace-a", source),
    ).resolves.toEqual({
      tone: "Warm and relaxed",
      audience: ["Home coffee enthusiasts"],
    });
    expect(mocks.generateText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        model: "mistral/ministral-14b",
        prompt: JSON.stringify({ websiteText: source }),
        maxRetries: 0,
      }),
    );
    expect(mocks.redisSet).toHaveBeenCalledExactlyOnceWith(
      "studio:website-profile:workspace-a",
      "1",
      "EX",
      30,
      "NX",
    );
  });

  it("skips research when throttled and keeps the website draft usable if inference fails", async () => {
    mocks.redisSet.mockResolvedValueOnce(null);
    await expect(
      suggestWebsiteBrandProfile("workspace-a", source),
    ).resolves.toEqual({});
    expect(mocks.generateText).not.toHaveBeenCalled();

    mocks.generateText.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(
      suggestWebsiteBrandProfile("workspace-a", source),
    ).resolves.toEqual({});
  });
});
