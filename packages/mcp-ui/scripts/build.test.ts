// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildViews, inlineAssets, VIEWS_DIR } from "./build.ts";

describe("inlineAssets", () => {
  it("inlines the module script and the stylesheet", () => {
    const html = [
      "<head>",
      '<script type="module" crossorigin src="/assets/index.js"></script>',
      '<link rel="stylesheet" crossorigin href="/assets/index.css">',
      "</head>",
    ].join("");

    expect(
      inlineAssets(html, {
        "/assets/index.js": 'console.log("$&", "</script>")',
        "/assets/index.css": "body{color:red}",
      }),
    ).toBe(
      [
        "<head>",
        '<script type="module">console.log("$&", "<\\/script>")</script>',
        "<style>body{color:red}</style>",
        "</head>",
      ].join(""),
    );
  });

  it("fails on an asset it cannot inline", () => {
    expect(() =>
      inlineAssets('<img src="/assets/logo.png">', {
        "/assets/logo.png": "",
      }),
    ).toThrow(/logo\.png/);
  });
});

describe("buildViews", () => {
  const outDir = mkdtempSync(join(tmpdir(), "mcp-ui-build-"));
  const viewIds = readdirSync(VIEWS_DIR);

  beforeAll(() => buildViews(outDir), 120_000);
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it("emits one self-contained HTML file per view", () => {
    expect(readdirSync(join(outDir, "views")).sort()).toEqual(
      viewIds.map((id) => `${id}.html`).sort(),
    );
    for (const id of viewIds) {
      const html = readFileSync(join(outDir, "views", `${id}.html`), "utf8");
      expect(html).toMatch(/<script type="module">/);
      expect(html).toMatch(/<style>/);
      expect(html).not.toMatch(/\s(src|href)=/);
      expect(html).not.toMatch(/<link\b/);
    }
  });

  it("exports the registry with hashed URIs and the typed ids", async () => {
    const { MCP_UI } = await import(join(outDir, "index.js"));

    expect(Object.keys(MCP_UI).sort()).toEqual([...viewIds].sort());
    for (const id of viewIds) {
      expect(MCP_UI[id].uri).toMatch(
        new RegExp(`^ui://sokosumi/${id}\\.[0-9a-f]{8}\\.html$`),
      );
      expect(MCP_UI[id].html).toBe(
        readFileSync(join(outDir, "views", `${id}.html`), "utf8"),
      );
    }
    expect(readFileSync(join(outDir, "index.d.ts"), "utf8")).toContain(
      `export type UiId = ${viewIds.map((id) => JSON.stringify(id)).join(" | ")};`,
    );
  });
});
