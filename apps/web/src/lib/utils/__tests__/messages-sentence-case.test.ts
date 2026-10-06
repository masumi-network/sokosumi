import { describe, expect, it } from "vitest";

import en from "../../../../messages/en.json";

/**
 * `DESIGN.md` → Voice & Content: UI copy is sentence case. This flags an
 * `en.json` value written in Title Case ("Create Task", "Back to Credits") so
 * it is caught in review rather than copied into the next screen.
 *
 * A value is split into label-sized segments (sentences, `/`, ` - `, brackets)
 * and a segment is Title Case when its first word and every significant word
 * after it are capitalised. Acronyms (`API`, `URIs`), file names (`DESIGN.md`)
 * and the proper nouns below are allowed to stay capitalised.
 */

/** Product, brand and document names that keep their capitals mid-label. */
const PROPER_PHRASES = [
  // Sokosumi products and features.
  "Soko Bot",
  "Soko Bots",
  "Content Studio",
  "Social Scheduling",
  "Sokosumi Projects",
  "Agent Identities",
  // The Files area, named as a destination ("Copy to Files").
  "to Files",
  "from Files",
  "From Files",
  // Legal documents, capitalised as titles in the sign-up consent copy too.
  "Terms of Service",
  "Terms and Conditions",
  "Privacy Policy",
  "Cookie Policy",
  "Acceptable Use",
  "Data Processing Agreement",
  // Other names.
  "Model Context Protocol",
  "Mistral Medium",
  "Florian Haller",
  "Serviceplan Group",
  "Acme Inc.",
  // Example organization name in a placeholder.
  "My Organization",
];

const PROPER_WORDS = new Set([
  "Sokosumi",
  "Google",
  "Microsoft",
  "Stripe",
  "WhatsApp",
  "WebP",
  "X",
  "Claude",
  "Eve",
  "YouTube",
  "LinkedIn",
  "Slack",
  "Notion",
  "Linear",
  "Markdown",
  "Word",
  "Office",
  "Drive",
  "Social",
  // Task status, quoted as the board column's name ("Reopen to Ready").
  "Ready",
]);

const MINOR_WORDS = new Set(
  "a an and as at but by for from in into nor of on onto or over per the to up via vs with".split(
    " ",
  ),
);

const SEGMENT_BREAK = /[.!?:;]\s+|\s+[-–—/]\s+|[()]/;

function stripPlaceholders(value: string): string {
  let text = value.replace(/<[^>]*>/g, " ");
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/\{[^{}]*\}/g, " ");
  }
  return text;
}

function isCapitalised(word: string): boolean {
  return /^[^\p{L}]*\p{Lu}/u.test(word);
}

function isExempt(word: string): boolean {
  const bare = word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
  return (
    PROPER_WORDS.has(bare) ||
    /^[A-Z\d]{2,}s?$/.test(bare) || // API, URL, URIs, 365
    /\.[a-z]/.test(bare) // DESIGN.md
  );
}

function isTitleCase(value: string): boolean {
  let text = stripPlaceholders(value);
  for (const phrase of PROPER_PHRASES) text = text.replaceAll(phrase, " ");

  return text.split(SEGMENT_BREAK).some((segment) => {
    const words = segment.split(/\s+/).filter((word) => /\p{L}/u.test(word));
    if (words.length < 2 || !isCapitalised(words[0])) return false;
    const rest = words
      .slice(1)
      .filter((word) => !MINOR_WORDS.has(word.toLowerCase()));
    return (
      rest.length > 0 &&
      rest.every(isCapitalised) &&
      rest.some((word) => !isExempt(word))
    );
  });
}

function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, child]) => leaves(child, [...path, key]),
  );
}

const EN_LEAVES = leaves(en);

describe("en.json sentence case", () => {
  it("has no Title Case values", () => {
    const violations = EN_LEAVES.filter(([, value]) => isTitleCase(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    expect(violations, violations.join("\n")).toEqual([]);
  });

  /** Without this the check above passes vacuously if the rule finds nothing. */
  it("still flags Title Case and passes sentence case", () => {
    expect(isTitleCase("Create Task")).toBe(true);
    expect(isTitleCase("Back to Credits")).toBe(true);
    expect(isTitleCase("Something Went Wrong")).toBe(true);
    expect(isTitleCase("Create New API Key")).toBe(true);
    expect(isTitleCase("Create task")).toBe(false);
    expect(isTitleCase("Create new API key")).toBe(false);
    expect(isTitleCase("Continue with Google")).toBe(false);
    expect(isTitleCase("Delete Soko Bot")).toBe(false);
    expect(isTitleCase("Job ID")).toBe(false);
  });

  it("keeps the proper-noun allowlist free of names en.json no longer uses", () => {
    const text = JSON.stringify(en);
    const stale = [...PROPER_PHRASES, ...PROPER_WORDS].filter(
      (name) => !new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, "u").test(text),
    );

    expect(stale).toEqual([]);
  });
});
