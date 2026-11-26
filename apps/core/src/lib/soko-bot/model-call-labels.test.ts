import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");
/**
 * The sandbox runner's calls reach the Gateway through Core's proxy, which
 * records them as the turn's agent calls.
 */
const SKIPPED = ["soko-bot-runner/", "lib/soko-bot/stream-model-call.ts"];
const CALL = /\b(generateText|streamText|streamModelCall)\(\{/;
const LOOKAHEAD_LINES = 30;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("model call labels", () => {
  it("gives every model call a telemetry functionId, the ledger's label", () => {
    const unlabelled = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      if (SKIPPED.some((skipped) => file.startsWith(skipped))) return [];
      const lines = readFileSync(path, "utf8").split("\n");
      return lines.flatMap((line, index) =>
        CALL.test(line) &&
        !lines
          .slice(index, index + LOOKAHEAD_LINES)
          .some((next) => next.includes("telemetry"))
          ? [`${file}:${index + 1}`]
          : [],
      );
    });
    expect(unlabelled).toEqual([]);
  });
});
