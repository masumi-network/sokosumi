import { describe, expect, it } from "vitest";
import { badRequest } from "@/helpers/error";
import { persistedErrorDetail } from "./seller-recovery";

describe("persistedErrorDetail", () => {
  it("keeps Core's own refusal but redacts a card number in the post it quotes", () => {
    expect(
      persistedErrorDetail(
        badRequest(
          'Rewrite the post: it says nearly what the post "Order line 4111 1111 1111 1111 ships today" says.',
        ),
      ),
    ).toBe(
      'Rewrite the post: it says nearly what the post "[Sensitive value removed]" says.',
    );
  });

  it("keeps an opening refusal countable while redacting the key it quotes", () => {
    expect(
      persistedErrorDetail(
        badRequest(
          `Rewrite the post's first line: “api_key=sk-live-abcdefghijklmnop1234” gives no reason to tap "see more".`,
        ),
      ),
    ).toBe(
      `Rewrite the post's first line: “[Sensitive value removed]” gives no reason to tap "see more".`,
    );
  });

  it("redacts a whole refusal whose customer value is not quoted", () => {
    expect(
      persistedErrorDetail(
        badRequest("Not saved: the card 4111 1111 1111 1111 is in the post."),
      ),
    ).toBe("[Sensitive value removed]");
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
