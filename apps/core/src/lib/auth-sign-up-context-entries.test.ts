import { describe, expect, it } from "vitest";

import { parseSignUpContextEntries } from "./auth-sign-up-context-entries";

const elevenEntries = Object.fromEntries(
  Array.from({ length: 11 }, (_, index) => [`key_${index}`, index]),
);

describe("parseSignUpContextEntries", () => {
  it.each([
    ["a missing parameter", null, {}],
    ["an empty parameter", "", {}],
    ["invalid JSON", "{url:", {}],
    ["a JSON array", '["nmkr.io"]', {}],
    ["a JSON string", '"nmkr.io"', {}],
    ["JSON null", "null", {}],
    ["a string entry", '{"url":"nmkr.io"}', { url: "nmkr.io" }],
    [
      "typed entries",
      '{"seats":3,"ratio":0.5,"trial":true,"paid":false,"seats_text":"3"}',
      { seats: 3, ratio: 0.5, trial: true, paid: false, seats_text: "3" },
    ],
    ["an empty string", '{"note":""}', { note: "" }],
    [
      "keys outside the pattern",
      '{"Url":"a","1st":"b","_x":"c","has-dash":"d","":"e","ok_1":"f"}',
      { ok_1: "f" },
    ],
    [
      "a 64-character key, and a 65-character one",
      JSON.stringify({ [`a${"b".repeat(63)}`]: 1, [`a${"b".repeat(64)}`]: 2 }),
      { [`a${"b".repeat(63)}`]: 1 },
    ],
    [
      "a 2,048-character value, and a 2,049-character one",
      JSON.stringify({ fits: "x".repeat(2048), long: "x".repeat(2049) }),
      { fits: "x".repeat(2048) },
    ],
    [
      "values that are not a string, finite number or boolean",
      '{"obj":{"a":1},"list":[1],"none":null,"big":1e999,"ok":true}',
      { ok: true },
    ],
    [
      "an 11th entry",
      JSON.stringify(elevenEntries),
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [`key_${index}`, index]),
      ),
    ],
    [
      "dropped entries, which leave room for later ones",
      JSON.stringify({ BAD: 1, ...elevenEntries }),
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [`key_${index}`, index]),
      ),
    ],
  ])("keeps the valid entries of %s", (_, raw, expected) => {
    expect(parseSignUpContextEntries(raw)).toEqual(expected);
  });
});
