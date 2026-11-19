import { describe, expect, it } from "vitest";

import { cmoChatMessage } from "../test-fixtures/cmo";
import { cusoText, toCusoMessages, withoutIdMentions } from "./chat-messages";

describe("toCusoMessages", () => {
  it("names a Coworker who writes in Cuso's room, never Sokosumi", () => {
    const [fromCoworker, fromNobody] = toCusoMessages([
      cmoChatMessage({
        id: "c1",
        content: "The research is done.",
        sender: {
          type: "coworker",
          coworker: {
            id: "hannah",
            name: "Hannah",
            slug: "hannah",
            caption: null,
            image: null,
            presence: "online",
          },
        },
      }),
      cmoChatMessage({
        id: "c2",
        content: "A note.",
        createdAt: new Date("2026-10-01T09:04:00Z"),
        sender: { type: "unknown" },
      }),
    ]);
    expect(fromCoworker).toMatchObject({ author: "Hannah", fromCuso: false });
    expect(fromNobody?.author).toBe("Team");
  });
});

describe("cusoText", () => {
  it("shows a leaked answer's message and drops the DONE marker", () => {
    expect(
      cusoText(
        '{"kind":"REPORT","message":"Subject changed.","question":null,"observationToolCallIds":[]}',
      ),
    ).toBe("Subject changed.");
    expect(cusoText("DONE: The November batch is ready.")).toBe(
      "The November batch is ready.",
    );
    expect(cusoText("{not json} still words")).toBe("{not json} still words");
  });
});

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
    expect(
      withoutIdMentions(
        "@5ZJ9yKQy2mhb01UHNIcGDMfiSCltiHYk The plan starts with your tariff.",
      ),
    ).toBe("The plan starts with your tariff.");
  });

  it("leaves handles and emails alone", () => {
    expect(
      withoutIdMentions("Follow @plausiblehq or write hi@plausible.io"),
    ).toBe("Follow @plausiblehq or write hi@plausible.io");
  });
});
