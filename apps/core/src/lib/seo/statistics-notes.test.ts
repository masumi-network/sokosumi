import { readdirSync, readFileSync } from "node:fs";
import * as utils from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

/** One sample call per note builder; the web reads each built note back. */
const BUILDERS: Record<string, () => string> = {
  seoStatisticsQueryRowsCutNote: () => utils.seoStatisticsQueryRowsCutNote(500),
  seoStatisticsKeywordRowsCutNote: () =>
    utils.seoStatisticsKeywordRowsCutNote(500),
  seoStatisticsKeywordsLeftOutNote: () =>
    utils.seoStatisticsKeywordsLeftOutNote(["kw (US)"], 25, 3),
};

const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** The text between the bracket at `open` and its match, skipping strings and nested brackets. */
function enclosed(source: string, open: number) {
  const stack = [CLOSE[source[open]]];
  for (let index = open + 1; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index++;
      while (index < source.length && source[index] !== char)
        index += source[index] === "\\" ? 2 : 1;
    } else if (CLOSE[char]) stack.push(CLOSE[char]);
    else if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return source.slice(open + 1, index);
    }
  }
  throw new Error(`No closing bracket after ${source.slice(open, open + 80)}`);
}

/** The arguments or items of a bracket's text, split at its own commas; an array item is read item by item. */
function items(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let from = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (CLOSE[char]) depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && !depth) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(text.slice(from));
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) =>
      part.startsWith("[") && part.endsWith("]")
        ? items(part.slice(1, -1))
        : [part],
    );
}

/** Each place the SEO code adds a statistics note: a push, unshift, splice, concat or a list of notes. */
const NOTE_WRITES =
  /\bnotes\.(push|unshift|concat|splice)\(|\bnotes(?::\s*string\[\])?\s*=\s*\[|\bnotes:\s*\[/g;

/** What Core passes as a statistics note in the SEO code. */
function noteArguments() {
  const dirs = [
    new URL(".", import.meta.url),
    new URL("../../services/", import.meta.url),
  ];
  const args: { file: string; arg: string }[] = [];
  for (const dir of dirs)
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const match of source.matchAll(NOTE_WRITES)) {
        const open = (match.index ?? 0) + match[0].length - 1;
        const found = items(enclosed(source, open));
        // splice(start, deleteCount, ...notes)
        for (const arg of match[1] === "splice" ? found.slice(2) : found)
          args.push({ file, arg });
      }
    }
  return args;
}

describe("statistics notes", () => {
  it("come only from the note catalog in @sokosumi/utils", () => {
    const args = noteArguments();
    // The scan must see Core's notes, or it proves nothing.
    expect(args.length).toBeGreaterThanOrEqual(15);
    const exports = utils as Record<string, unknown>;
    for (const { file, arg } of args) {
      const name = /^([A-Za-z_$][\w$]*)(\(?)/.exec(arg);
      expect(name, `${file}: ${arg}`).not.toBeNull();
      const [, identifier, call] = name ?? [];
      const note = call
        ? BUILDERS[identifier]?.()
        : (exports[identifier] as string | undefined);
      expect(typeof note, `${file}: ${arg}`).toBe("string");
      expect(
        utils.readSeoStatisticsNote(note ?? ""),
        `${file}: ${arg}`,
      ).not.toBeNull();
    }
  });
});
