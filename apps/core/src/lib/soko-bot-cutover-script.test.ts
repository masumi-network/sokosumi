import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = readFileSync(
  join(coreRoot, "scripts/import-soko-bot-cutover.mts"),
  "utf8",
);

describe("Soko Bot cutover importer safety", () => {
  it("requires explicit writer-freeze confirmation before apply", () => {
    expect(source).toContain('args.includes("--confirm-source-frozen")');
    expect(source).toContain("--apply requires --confirm-source-frozen");
  });

  it("rejects invalid input before opening one serializable write transaction", () => {
    const validationGuard = source.indexOf("if (apply && !hasInvalid)");
    const transaction = source.indexOf("await prisma.$transaction(");

    expect(validationGuard).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(validationGuard);
    expect(source).toContain('isolationLevel: "Serializable"');
    expect(source).toContain("Duplicate schedule id in source export");
    expect(source).toContain(
      "Legacy schedule id already belongs to a different target",
    );
  });
});
