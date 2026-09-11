import { describe, expect, it } from "vitest";

import { buildDirectRoomName } from "./direct-room-name";

describe("buildDirectRoomName", () => {
  it("formats short direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena"])).toBe("Andreas, Elena");
  });

  it("compacts long direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena", "Hannah", "Alex"])).toBe(
      "Andreas, Elena, Hannah and 1 more",
    );
  });

  it("drops blanks and repeats before counting", () => {
    expect(buildDirectRoomName(["Andreas", " Andreas ", "", "Elena"])).toBe(
      "Andreas, Elena",
    );
  });

  it("names a room nobody is left in", () => {
    expect(buildDirectRoomName([])).toBe("Direct message");
    expect(buildDirectRoomName(["  "])).toBe("Direct message");
  });
});
