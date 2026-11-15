import { describe, expect, it } from "vitest";
import {
  isStaleSokoBotReply,
  readSokoBotAttemptAt,
} from "./soko-bot-reply-order.js";

const thinking = (at: number) => ({
  streaming: true,
  soko_bot: { attempt_at: at },
});
const settled = (at: number) => ({
  mention_failed: true,
  soko_bot: { attempt_at: at },
});

describe("Soko Bot reply order", () => {
  it("reads the attempt start", () => {
    expect(readSokoBotAttemptAt(thinking(5))).toBe(5);
    expect(
      readSokoBotAttemptAt({ soko_bot: { turn_id: "t" } }),
    ).toBeUndefined();
    expect(readSokoBotAttemptAt(null)).toBeUndefined();
  });
  it("drops Thinking of an attempt that already settled", () => {
    expect(isStaleSokoBotReply(settled(5), thinking(5))).toBe(true);
  });
  it("drops any copy of an earlier attempt", () => {
    expect(isStaleSokoBotReply(thinking(6), settled(5))).toBe(true);
    expect(isStaleSokoBotReply(settled(6), settled(5))).toBe(true);
  });
  it("takes a newer attempt and the attempt's own settled copy", () => {
    expect(isStaleSokoBotReply(settled(5), thinking(6))).toBe(false);
    expect(isStaleSokoBotReply(thinking(6), settled(6))).toBe(false);
  });
  it("keeps last-wins without an attempt", () => {
    expect(isStaleSokoBotReply(settled(5), { streaming: true })).toBe(false);
  });
});
