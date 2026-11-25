// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Lints `code` as a file in this package, so the package's Biome config applies. */
function lint(code: string) {
  const dir = mkdtempSync(join(PACKAGE_DIR, "src", "lint-probe-"));
  try {
    writeFileSync(join(dir, "probe.tsx"), code);
    const run = spawnSync("pnpm", ["exec", "biome", "lint", dir], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
    });
    return { failed: run.status !== 0, output: run.stdout + run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("raw HTML ban", () => {
  it.each([
    ["innerHTML", "export const f = (el: Element) => { el.innerHTML = 'x'; };"],
    ["outerHTML", "export const f = (el: Element) => { el.outerHTML = 'x'; };"],
    [
      "computed innerHTML",
      "export const f = (el: Element) => { el['innerHTML'] = 'x'; };",
    ],
    [
      "innerHTML in an object",
      "export const f = (el: Element) => Object.assign(el, { innerHTML: 'x' });",
    ],
    [
      "insertAdjacentHTML",
      "export const f = (el: Element) => el.insertAdjacentHTML('beforeend', 'x');",
    ],
    [
      "dangerouslySetInnerHTML",
      "export const F = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;",
    ],
  ])("fails on %s", (_name, code) => {
    const result = lint(code);
    expect(result.failed).toBe(true);
    expect(result.output).toMatch(/ADR 0083|noDangerouslySetInnerHtml/);
  });

  it("passes plain text rendering", () => {
    const result = lint(
      "export const F = ({ text }: { text: string }) => <p>{text}</p>;\n",
    );
    expect(result.output).not.toMatch(/error/i);
    expect(result.failed).toBe(false);
  });
});
