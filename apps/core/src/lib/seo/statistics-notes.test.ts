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

/** What Core passes as a statistics note: each push and each start list of the SEO code. */
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
      for (const match of source.matchAll(/notes\.push\(([\s\S]*?)\);/g))
        args.push({ file, arg: match[1].trim().replace(/,$/, "") });
      for (const match of source.matchAll(
        /\bnotes(?::\s*string\[\])?\s*=\s*\[([^\]]*)\]/g,
      ))
        for (const arg of match[1].split(","))
          if (arg.trim()) args.push({ file, arg: arg.trim() });
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
