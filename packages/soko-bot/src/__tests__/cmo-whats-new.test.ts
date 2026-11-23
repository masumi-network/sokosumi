import { cmoJargonIn } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  CMO_SOKO_BOT_VERSION_ID,
  cmoWhatsNew,
  SOKO_BOT_PRODUCT_VERSIONS,
} from "../versions/index.js";

describe("cmoWhatsNew", () => {
  it("lists every skipped version's lines, newest first", () => {
    expect(cmoWhatsNew("cmo-v13", "cmo-v15")).toEqual([
      "Your strategy and Cuso's messages now use plain words, without marketing jargon.",
      "More posts on the networks that suit your business, at the pace each one likes.",
      "Short videos, each made once and shared on TikTok, Instagram Reels and YouTube Shorts.",
    ]);
    expect(cmoWhatsNew("cmo-v14", "cmo-v15")).toHaveLength(1);
  });

  it("is empty for a move that is not an upgrade", () => {
    expect(cmoWhatsNew("cmo-v15", "cmo-v15")).toEqual([]);
    expect(cmoWhatsNew("cmo-v15", "cmo-v13")).toEqual([]);
    expect(cmoWhatsNew(null, "cmo-v15")).toEqual([]);
    expect(cmoWhatsNew("v34", "cmo-v15")).toEqual([]);
  });

  it("never shows more than four lines", () => {
    expect(cmoWhatsNew("cmo-v1", "cmo-v99").length).toBeLessThanOrEqual(4);
  });

  it("tells an owner moved onto the hire default what changed", () => {
    expect(cmoWhatsNew("cmo-v1", CMO_SOKO_BOT_VERSION_ID)).not.toEqual([]);
  });

  it("writes every line short and without marketing jargon", () => {
    const lines = SOKO_BOT_PRODUCT_VERSIONS.flatMap(
      (version) => version.whatsNew ?? [],
    );
    for (const line of lines) {
      expect(cmoJargonIn(line), line).toEqual([]);
      expect(line.length, line).toBeLessThanOrEqual(100);
      expect(line).not.toMatch(/[—–]/);
    }
  });
});
