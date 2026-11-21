import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({
  gateway: (model: string) => model,
  generateText,
  Output: { object: (input: unknown) => input },
}));
vi.mock("@/lib/soko-bot/gateway-cost", () => ({
  gatewayCallUsage: () => ({ inputTokens: 0, outputTokens: 0 }),
  gatewayCostUsd: () => 0.01,
}));

import sharp from "sharp";
import {
  checkStyledPicture,
  type StyleCheckVerdict,
  styleCheckPasses,
} from "./style-check";

const clean: StyleCheckVerdict = {
  text: ["Review before you pay"],
  headlineCorrect: true,
  legible: true,
  copiedFromReference: false,
  brandColours: true,
  extraMarks: false,
  logo: "correct",
  plainCorner: null,
  garbled: false,
  screenFaithful: true,
  problems: [],
};

describe("styleCheckPasses", () => {
  it("passes a clean picture and turns down each failure", () => {
    expect(styleCheckPasses(clean)).toBe(true);
    expect(styleCheckPasses({ ...clean, headlineCorrect: false })).toBe(false);
    expect(styleCheckPasses({ ...clean, extraMarks: true })).toBe(false);
  });

  // The 16 Nov test drew the logo into the print; a drawn logo needs no
  // corner, a missing one needs any plain corner, a misdrawn one fails.
  it("passes a drawn logo, or a missing one with a plain corner to place it", () => {
    expect(styleCheckPasses({ ...clean, logo: "wrong" })).toBe(false);
    expect(styleCheckPasses({ ...clean, logo: "absent" })).toBe(false);
    expect(
      styleCheckPasses({ ...clean, logo: "absent", plainCorner: "top-left" }),
    ).toBe(true);
  });

  it("turns down a picture that invents what the brand's own page shows", () => {
    expect(styleCheckPasses({ ...clean, screenFaithful: false })).toBe(false);
  });
});

describe("checkStyledPicture", () => {
  beforeEach(() => {
    generateText.mockReset();
    generateText.mockResolvedValue({ output: clean });
  });

  // NMKR's scenes ask for tokens, and 8 of 46 refusals (2026-11-19) were
  // tokens read as stray coins; a real coin's mark is still turned down.
  it("reads the scene, so a token it asks for is not a stray coin", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await checkStyledPicture({
      picture: new Uint8Array(png),
      reference: new Uint8Array(png),
      headline: "Own the asset",
      colours: ["#11f250"],
      scene: "A hand passing a token to a buyer",
    });
    const call = generateText.mock.calls[0]?.[0];
    expect(JSON.parse(call.messages[0].content[0].text)).toMatchObject({
      scene: "A hand passing a token to a buyer",
    });
    expect(call.system).toContain(
      "A token, NFT or coin the scene asks for is asked for",
    );
    expect(call.system).toContain("real currency's or company's symbol");
  });

  // 20 of 47 rejections (2026-11-20) were "brand colours don't lead" on
  // faithful sepia and ink prints; the test lettered a second line and nmkr.io.
  it("allows period tones, a second line, the address and the drawn logo", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#0000" },
    })
      .png()
      .toBuffer();
    await checkStyledPicture({
      picture: new Uint8Array(png),
      reference: new Uint8Array(png),
      headline: "Mint now",
      lines: ["Tokens and NFTs for everyone", "nmkr.io"],
      colours: ["#11f250"],
      logo: new Uint8Array(png),
    });
    const call = generateText.mock.calls[0]?.[0];
    expect(call.system).toContain("no colour outside them dominates");
    expect(call.system).not.toContain("lead the picture");
    expect(call.system).toContain("one of the lines given");
    expect(call.system).toContain("The third image is the brand's logo");
    expect(call.system).toContain("real currency's or company's symbol");
    expect(call.system).toContain("no price, number, plan name");
    expect(JSON.parse(call.messages[0].content[0].text).lines).toEqual([
      "Tokens and NFTs for everyone",
      "nmkr.io",
    ]);
    // Picture, reference, logo.
    expect(call.messages[0].content).toHaveLength(4);
  });
});
