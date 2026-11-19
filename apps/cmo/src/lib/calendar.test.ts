import { describe, expect, it } from "vitest";

import {
  connectedNetworks,
  pieceMade,
  waitsForNetwork,
  wholeWords,
} from "./calendar";

const piece = (status: "idea" | "draft" | "scheduled", format: string) => ({
  status,
  channel: "linkedin",
  format,
});

it("counts a piece made once it is scheduled or out", () => {
  expect(pieceMade(piece("scheduled", "image"), false)).toBe(true);
  expect(
    pieceMade({ ...piece("idea", "post"), status: "published" }, false),
  ).toBe(true);
});

it("keeps a written piece in the making until its picture or video exists", () => {
  expect(pieceMade(piece("draft", "post"), false)).toBe(true);
  expect(pieceMade(piece("draft", "image"), false)).toBe(false);
  expect(pieceMade(piece("draft", "video"), true)).toBe(true);
});

it("never shows a topic as made", () => {
  expect(pieceMade(piece("idea", "post"), true)).toBe(false);
});

describe("a written post on a network that is not connected", () => {
  it("waits for that network, and for nothing once it is connected", () => {
    const post = { status: "draft" as const, channel: "linkedin" };
    expect(waitsForNetwork(post, ["x"])).toBe("linkedin");
    expect(waitsForNetwork(post, ["x", "linkedin"])).toBeNull();
  });

  it("never says so for a scheduled post or a piece that is not a social post", () => {
    expect(
      waitsForNetwork({ status: "scheduled", channel: "linkedin" }, []),
    ).toBeNull();
    expect(
      waitsForNetwork({ status: "draft", channel: "newsletter" }, []),
    ).toBeNull();
  });

  it("reads the live connections only", () => {
    expect(
      connectedNetworks([
        {
          id: "1",
          provider: "X",
          handle: null,
          displayName: null,
          status: "active",
          personalProfile: false,
        },
        {
          id: "2",
          provider: "linkedin",
          handle: null,
          displayName: null,
          status: "EXPIRED",
          personalProfile: false,
        },
      ]),
    ).toEqual(["x"]);
  });
});

describe("wholeWords", () => {
  it("ends an excerpt on a whole word, never inside one", () => {
    const text = "Cuso prepares that month for you to read before it goes out";
    expect(wholeWords(text, 16)).toBe("Cuso prepares…");
    expect(wholeWords(text, 17)).toBe("Cuso prepares…");
    expect(wholeWords(text, 18)).toBe("Cuso prepares that…");
    expect(wholeWords("Short.", 16)).toBe("Short.");
  });
});
