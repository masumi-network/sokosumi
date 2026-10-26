import { describe, expect, it } from "vitest";

import { parseMailingList } from "./cmo-mailing-list.service";

describe("parseMailingList", () => {
  it("reads a CSV export with names, whatever the column order", () => {
    expect(
      parseMailingList(
        '﻿First name;Last name;Email\nAda;Lovelace;ADA@example.com\n"Grace";"Hopper";grace@example.org\n',
      ),
    ).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "grace@example.org", name: "Grace Hopper" },
    ]);
  });

  it("reads one address a line, skips junk and duplicates", () => {
    expect(
      parseMailingList(
        "ada@example.com\nnot an email\n\nAda <ada@example.com>\nbob@test.io",
      ),
    ).toEqual([
      { email: "ada@example.com", name: undefined },
      { email: "bob@test.io", name: undefined },
    ]);
  });

  it("keeps whole addresses and ignores long junk lines quickly", () => {
    expect(parseMailingList("o'connor@example.com\nada@@example.com")).toEqual([
      { email: "o'connor@example.com", name: undefined },
    ]);
    const started = performance.now();
    expect(parseMailingList(`${"a".repeat(40_000)}\nbob@test.io`)).toEqual([
      { email: "bob@test.io", name: undefined },
    ]);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("uses a name column and quoted cells with commas", () => {
    expect(
      parseMailingList('name,email\n"Lovelace, Ada",ada@example.com'),
    ).toEqual([{ email: "ada@example.com", name: "Lovelace, Ada" }]);
  });
});
