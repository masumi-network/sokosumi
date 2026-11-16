import { normalizeHex } from "@sokosumi/utils";

/**
 * A DESIGN.md's YAML front matter, read for people: its colour and type
 * tokens. Everything else in the front matter stays as written.
 */

interface YamlMap {
  [key: string]: string | YamlMap;
}

export interface DesignMdColorToken {
  name: string;
  /** As written: a hex code, or another notation such as "{colors.primary}". */
  value: string;
  /** Six-digit hex to paint the swatch; null when `value` is not a hex. */
  hex: string | null;
}

export interface DesignMdTypeToken {
  name: string;
  family: string | null;
  size: string | null;
  weight: string | null;
}

export interface DesignMdTokens {
  colors: DesignMdColorToken[];
  typography: DesignMdTypeToken[];
}

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * The front matter between the opening and closing `---` lines, and the
 * Markdown after it. Null when the file does not open with a closed block.
 */
export function splitFrontMatter(
  markdown: string,
): { frontMatter: string; body: string } | null {
  const match = FRONT_MATTER.exec(markdown);
  if (!match) return null;
  return {
    frontMatter: match[1] ?? "",
    body: markdown.slice(match[0].length),
  };
}

const KEY_LINE =
  /^([ \t]*)(?:"([^"]*)"|'([^']*)'|([^\s#'"\-\[{][^:#]*?)):(?:[ \t]+(.*))?$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*\s*(?:#.*)?$/;
const QUOTED = /^(["'])(.*?)\1(?:\s+#.*)?$/;

function scalar(raw: string): string {
  const value = raw.trim();
  const quoted = QUOTED.exec(value);
  return quoted ? (quoted[2] ?? "") : value.replace(/\s+#.*$/, "");
}

/**
 * Nested `key: value` maps by indentation. Lists, flow collections and block
 * scalars are skipped, so a front matter this cannot read gives fewer
 * tokens, never an error.
 * ponytail: not a YAML parser; a wrapped plain scalar line that looks like
 * `key: value` reads as a key. Swap for a YAML package if tokens go missing.
 */
function readYamlMap(source: string): YamlMap {
  const root: YamlMap = Object.create(null);
  const parents: { indent: number; map: YamlMap }[] = [
    { indent: -1, map: root },
  ];
  let blockIndent: number | null = null;

  for (const line of source.split(/\r?\n/)) {
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null) {
      if (!line.trim() || indent > blockIndent) continue;
      blockIndent = null;
    }
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    while (parents.length > 1 && (parents.at(-1)?.indent ?? -1) >= indent) {
      parents.pop();
    }
    const parent = parents.at(-1)?.map ?? root;
    const key = match[2] ?? match[3] ?? match[4] ?? "";
    const raw = match[5] ?? "";
    if (BLOCK_SCALAR.test(raw.trim())) {
      blockIndent = indent;
      continue;
    }
    const value = scalar(raw);
    if (value) {
      parent[key] = value;
    } else {
      const child: YamlMap = Object.create(null);
      parent[key] = child;
      parents.push({ indent, map: child });
    }
  }
  return root;
}

function isMap(value: string | YamlMap | undefined): value is YamlMap {
  return typeof value === "object";
}

function text(value: string | YamlMap | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** The `colors` and `typography` tokens of a DESIGN.md front matter. */
export function designMdTokens(frontMatter: string): DesignMdTokens {
  const yaml = readYamlMap(frontMatter);
  const colors = isMap(yaml.colors)
    ? Object.entries(yaml.colors).flatMap(([name, value]) =>
        typeof value === "string"
          ? [{ name, value, hex: normalizeHex(value) }]
          : [],
      )
    : [];
  const typography = isMap(yaml.typography)
    ? Object.entries(yaml.typography).flatMap(([name, style]) =>
        isMap(style)
          ? [
              {
                name,
                family: text(style.fontFamily),
                size: text(style.fontSize),
                weight: text(style.fontWeight),
              },
            ]
          : [],
      )
    : [];
  return { colors, typography };
}
