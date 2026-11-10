import { describe, expect, it } from "vitest";

import { designMdTokens, splitFrontMatter } from "./design-md-front-matter";

const DESIGN_MD = `---
version: alpha
name: Example
description: >-
  A wrapped description
  colors: not a key, part of the text
logo:
  src: data:,
colors:
  primary: '#2F7D4F'
  "on-primary": "#fff" # white text
  surface: '#eeeeee'
  link: '{colors.primary}'
  broken
typography:
  display:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '300'
  body-md:
    fontFamily: system-ui
    fontWeight: 400
components:
  button:
    backgroundColor: '{colors.primary}'
---
## Overview

The guidance.
`;

describe("splitFrontMatter", () => {
  it("splits the front matter from the Markdown after it", () => {
    const split = splitFrontMatter(DESIGN_MD);
    expect(split?.frontMatter.startsWith("version: alpha")).toBe(true);
    expect(split?.body).toBe("## Overview\n\nThe guidance.\n");
  });

  it("reads CRLF files and an empty block", () => {
    expect(splitFrontMatter("---\r\na: 1\r\n---\r\nBody")).toEqual({
      frontMatter: "a: 1",
      body: "Body",
    });
    expect(splitFrontMatter("---\n---\nBody")).toEqual({
      frontMatter: "",
      body: "Body",
    });
  });

  it("leaves files without a closed block alone", () => {
    expect(splitFrontMatter("# Title\n---\nmore")).toBeNull();
    expect(splitFrontMatter("---\ncolors:\n  a: '#fff'\n# no end")).toBeNull();
  });
});

describe("designMdTokens", () => {
  it("reads named colours with their hex, keeping values it cannot paint", () => {
    expect(
      designMdTokens(splitFrontMatter(DESIGN_MD)?.frontMatter ?? "").colors,
    ).toEqual([
      { name: "primary", value: "#2F7D4F", hex: "#2f7d4f" },
      { name: "on-primary", value: "#fff", hex: "#ffffff" },
      { name: "surface", value: "#eeeeee", hex: "#eeeeee" },
      { name: "link", value: "{colors.primary}", hex: null },
    ]);
  });

  it("reads type styles with their family, size and weight", () => {
    expect(
      designMdTokens(splitFrontMatter(DESIGN_MD)?.frontMatter ?? "").typography,
    ).toEqual([
      { name: "display", family: "Inter", size: "30px", weight: "300" },
      { name: "body-md", family: "system-ui", size: null, weight: "400" },
    ]);
  });

  it("gives no tokens for front matter it cannot read, never throws", () => {
    for (const source of [
      "",
      "colors: [red, blue]",
      "colors:\n  - '#fff'\n  - '#000'",
      "typography: none\ncolors: '#fff'",
      ":::\n\t- {\n  ]: x",
      "__proto__:\n  polluted: yes",
    ]) {
      expect(designMdTokens(source)).toEqual({ colors: [], typography: [] });
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
