import { describe, expect, it } from "vitest";

import { parseTaskRef } from "./task-ref";

const UUID = "01960001-0001-7001-8001-000000000042";

describe("parseTaskRef", () => {
  it.each([
    ["SOK-12", { prefix: "SOK", number: 12 }],
    ["sok-12", { prefix: "SOK", number: 12 }],
    ["Sok-1", { prefix: "SOK", number: 1 }],
    ["SOK-12-some-slug", { prefix: "SOK", number: 12 }],
    ["SOK-12-", { prefix: "SOK", number: 12 }],
    ["AB-999999999", { prefix: "AB", number: 999999999 }],
    ["ABCDEFG-3", { prefix: "ABCDEFG", number: 3 }],
    ["P42-7", { prefix: "P42", number: 7 }],
  ])("parses identifier %s", (ref, expected) => {
    expect(parseTaskRef(ref)).toEqual({ kind: "identifier", ...expected });
  });

  it("recognises a uuid before anything else", () => {
    expect(parseTaskRef(UUID)).toEqual({ kind: "id", id: UUID });
    expect(parseTaskRef(UUID.toUpperCase())).toEqual({
      kind: "id",
      id: UUID.toUpperCase(),
    });
  });

  it.each([
    "",
    "tsk_123",
    "SOK",
    "SOK-",
    "SOK-abc",
    "SOK12",
    "S-12",
    "ABCDEFGH-12",
    "1AB-12",
    "SOK-1234567890",
    "SOK--12",
    " SOK-12",
    "SOK-12 ",
    "../SOK-12",
  ])("returns null for %j", (ref) => {
    expect(parseTaskRef(ref)).toBeNull();
  });
});
