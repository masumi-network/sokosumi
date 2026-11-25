import { describe, expect, it } from "vitest";
import {
  CMO_PIECE_CREDITS,
  cmoMonthPieceBudget,
  cmoPieceCredits,
} from "./cmo-month-credits";

describe("cmoPieceCredits", () => {
  it("prices a talking video at its longest script with the site, B-roll and music", () => {
    expect(CMO_PIECE_CREDITS.talkingVideo).toBe(251);
    expect(cmoPieceCredits("linkedin", "talking_video")).toBe(251);
  });

  it("prices pictures per slide, short videos, five-second videos and words", () => {
    expect(cmoPieceCredits("x", "image")).toBe(4);
    expect(cmoPieceCredits("instagram", "carousel")).toBe(40);
    expect(cmoPieceCredits("tiktok", "video")).toBe(14);
    expect(cmoPieceCredits("linkedin", "video")).toBe(21);
    expect(cmoPieceCredits("x", "post")).toBe(0);
    expect(cmoPieceCredits("myspace", "post")).toBe(0);
  });

  it("keeps 30% of each plan's credits for Cuso's own work", () => {
    expect(cmoMonthPieceBudget("steady")).toBe(7000);
    expect(cmoMonthPieceBudget("all_in")).toBe(35_000);
  });
});
