import { describe, expect, it } from "vitest";
import { badRequest } from "@/helpers/error";
import { persistedErrorDetail } from "./seller-recovery";

describe("persistedErrorDetail", () => {
  it("keeps Core's own refusal although the post it quotes looks like a card number", () => {
    const refusal =
      'Rewrite the post: it says nearly what the post "Order line 4111 1111 1111 1111 ships today" says.';

    expect(persistedErrorDetail(badRequest(refusal))).toBe(refusal);
  });

  it("keeps prices such as 150 ADA or 3% or a minimum of 2 ADA", () => {
    const refusal =
      'Rewrite the post: it says nearly what the post "NMKR lists verification at 150 ADA, 3% or a minimum of 2 ADA per token" says.';

    expect(persistedErrorDetail(badRequest(refusal))).toBe(refusal);
    expect(persistedErrorDetail(new Error(refusal))).toBe(refusal);
  });

  it("still redacts any other error, which can carry a provider's text", () => {
    expect(
      persistedErrorDetail(new Error("api_key=sk-live-abcdefghijklmnop1234")),
    ).toBe("[Sensitive value removed]");
  });
});
