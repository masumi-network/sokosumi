import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({
  gateway: (model: string) => model,
  generateText,
  Output: { object: (input: unknown) => input },
}));
vi.mock("@/lib/soko-bot/gateway-cost", () => ({
  gatewayCallUsage: () => ({ inputTokens: 0, outputTokens: 0 }),
  gatewayCostUsd: () => 0.02,
}));

import { layoutBlockMap, pickBestPicture } from "./layout";

const picture = (background: string) =>
  sharp({ create: { width: 64, height: 80, channels: 3, background } })
    .jpeg()
    .toBuffer();

beforeEach(() => generateText.mockReset());

describe("layoutBlockMap", () => {
  it("keeps the frame's shape in three greys and drops every colour", async () => {
    const map = await layoutBlockMap(await picture("#3366cc"));
    const { width, height } = await sharp(map).metadata();
    expect(width).toBe(800);
    expect(height).toBe(1000);
    const { data } = await sharp(map)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(new Set(data)).toEqual(new Set([150]));
  });
});

describe("pickBestPicture", () => {
  it("shows the layout first and returns the candidate it names, with why", async () => {
    generateText.mockResolvedValue({
      output: { best: 2, reason: "Clearest headline" },
    });
    const result = await pickBestPicture({
      candidates: [await picture("#fff"), await picture("#000")],
      layout: await picture("#888"),
      brief: { scene: "A press", headline: "Mint now", kind: "bold graphic" },
      look: "Flat brand look.",
    });
    expect(result).toEqual({
      index: 1,
      reason: "Clearest headline",
      costUsd: 0.02,
    });
    const content = generateText.mock.calls[0]?.[0].messages[0].content;
    expect(content).toHaveLength(4);
    expect(JSON.parse(content[0].text)).toMatchObject({
      brandLook: "Flat brand look.",
    });
  });

  it("never returns a candidate that does not exist", async () => {
    generateText.mockResolvedValue({ output: { best: 9, reason: "?" } });
    const result = await pickBestPicture({
      candidates: [await picture("#fff")],
      layout: await picture("#888"),
      brief: { scene: null, headline: null, kind: null },
      look: "",
    });
    expect(result.index).toBe(0);
  });
});
