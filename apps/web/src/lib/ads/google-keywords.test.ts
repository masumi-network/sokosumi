import { describe, expect, it } from "vitest";

import {
  appendBroadKeywords,
  GOOGLE_KEYWORD_LIMIT,
  parseGoogleKeywords,
} from "./google-keywords";

describe("parseGoogleKeywords", () => {
  it("reads broad, phrase and exact lines", () => {
    const { keywords, invalid } = parseGoogleKeywords(
      'running shoes\n"trail shoes"\n[buy shoes online]',
    );

    expect(keywords).toEqual([
      { text: "running shoes", matchType: "BROAD" },
      { text: "trail shoes", matchType: "PHRASE" },
      { text: "buy shoes online", matchType: "EXACT" },
    ]);
    expect(invalid).toEqual([]);
  });

  it("trims, collapses spaces, drops blank lines and reads CRLF", () => {
    const { keywords } = parseGoogleKeywords(
      '  running   shoes  \r\n\r\n   \r\n" trail  shoes "\r\n',
    );

    expect(keywords).toEqual([
      { text: "running shoes", matchType: "BROAD" },
      { text: "trail shoes", matchType: "PHRASE" },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseGoogleKeywords("  \n\n")).toEqual({
      keywords: [],
      invalid: [],
    });
  });

  it.each([
    ['"unclosed'],
    ['closed"'],
    ["[unclosed"],
    ["closed]"],
    ['""'],
    ["[]"],
    ['"a "b" c"'],
    ["[a [b]]"],
    ["mixed [brackets] inside"],
  ])("reports %s as a syntax error", (line) => {
    expect(parseGoogleKeywords(line).invalid).toEqual([
      { line: 1, text: line, issue: "syntax" },
    ]);
  });

  it("reports a keyword over 80 characters or 10 words, by original line number", () => {
    const long = "a".repeat(81);
    const wordy = "one two three four five six seven eight nine ten eleven";
    const { keywords, invalid } = parseGoogleKeywords(
      `ok\n\n${long}\n"${wordy}"\n${"a".repeat(80)}`,
    );

    expect(invalid).toEqual([
      { line: 3, text: long, issue: "tooLong" },
      { line: 4, text: `"${wordy}"`, issue: "tooManyWords" },
    ]);
    expect(keywords.map(({ text }) => text)).toEqual(["ok", "a".repeat(80)]);
  });

  it("accepts exactly 10 words", () => {
    const ten = "one two three four five six seven eight nine ten";
    expect(parseGoogleKeywords(ten).invalid).toEqual([]);
  });

  it("drops repeats of the same text and match type, ignoring case", () => {
    const { keywords } = parseGoogleKeywords(
      'Shoes\nshoes\n"shoes"\n"SHOES"\n[shoes]\n[Shoes]',
    );

    expect(keywords).toEqual([
      { text: "Shoes", matchType: "BROAD" },
      { text: "shoes", matchType: "PHRASE" },
      { text: "shoes", matchType: "EXACT" },
    ]);
  });
});

describe("appendBroadKeywords", () => {
  it("appends new keywords as broad lines", () => {
    expect(appendBroadKeywords("running shoes", ["trail shoes"])).toEqual({
      text: "running shoes\ntrail shoes\n",
      added: 1,
    });
  });

  it("starts the text when it is empty", () => {
    expect(appendBroadKeywords("", ["a", "b"])).toEqual({
      text: "a\nb\n",
      added: 2,
    });
  });

  it("skips keywords already there in any match type, ignoring case", () => {
    const current = '"Running Shoes"\n[trail shoes]';
    expect(
      appendBroadKeywords(current, [
        "running shoes",
        "TRAIL SHOES",
        "new one",
        "new one",
      ]),
    ).toEqual({ text: `${current}\nnew one\n`, added: 1 });
  });

  it("leaves the text untouched when nothing is added", () => {
    expect(appendBroadKeywords("a\n\n", ["A"])).toEqual({
      text: "a\n\n",
      added: 0,
    });
  });

  it("skips keywords Core would refuse", () => {
    expect(
      appendBroadKeywords("", ["ok", '"quoted"', "x".repeat(81), "[a]"]),
    ).toEqual({ text: "ok\n", added: 1 });
  });

  it("stops at the limit", () => {
    const current = Array.from(
      { length: GOOGLE_KEYWORD_LIMIT - 2 },
      (_, i) => `existing ${i}`,
    ).join("\n");
    const result = appendBroadKeywords(current, ["a", "b", "c", "d"]);

    expect(result.added).toBe(2);
    expect(parseGoogleKeywords(result.text).keywords).toHaveLength(
      GOOGLE_KEYWORD_LIMIT,
    );
  });
});
