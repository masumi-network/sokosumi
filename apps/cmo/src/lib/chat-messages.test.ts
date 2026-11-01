import { describe, expect, it } from "vitest";

import { withoutIdMentions } from "./chat-messages";

describe("withoutIdMentions", () => {
  it("drops a mention by id and keeps the words", () => {
    expect(
      withoutIdMentions(
        "@01a1963e-beda-7593-a92e-e7261c344da4 What stood out is the model.",
      ),
    ).toBe("What stood out is the model.");
    expect(
      withoutIdMentions(
        "Thanks @01a1963e-beda-7593-a92e-e7261c344da4:paula for the answer.",
      ),
    ).toBe("Thanks for the answer.");
  });

  it("leaves handles and emails alone", () => {
    expect(
      withoutIdMentions("Follow @plausiblehq or write hi@plausible.io"),
    ).toBe("Follow @plausiblehq or write hi@plausible.io");
  });
});
