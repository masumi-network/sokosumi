// Needs Chrome. Run: node --test .agents/skills/create-new-in-sokosumi/render.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const render = join(import.meta.dirname, "render.mjs");
const work = mkdtempSync(join(tmpdir(), "new-in-sokosumi-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

const pitch = (headline) => `<section class="pitch">
  <h1>${headline}</h1>
  <p class="lede">Mention a teammate in a task comment and they join the task.</p>
  <ul><li>Type @ to mention anyone</li><li>They join as participants</li><li>Notified in-app</li><li>Remove in one click</li></ul>
</section>`;
const mock = (body) => `<section class="mocks"><figure class="mock">
  <figcaption>Mention in a comment</figcaption>
  <div class="panel">${body}</div>
</figure></section>`;
const card = (text) =>
  `<div class="card"><div class="row"><span class="avatar">A</span><b>Ada</b><span class="when">2h</span></div><p>${text}</p></div>`;

function run(name, fragment, out = join(work, `${name}.png`), env = {}) {
  const input = join(work, `${name}.html`);
  writeFileSync(input, fragment);
  const result = spawnSync(process.execPath, [render, input, out], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stderr: result.stderr, out };
}

describe("render.mjs", () => {
  it("renders a clean fragment into a directory that does not exist yet", () => {
    const out = join(work, "nested", "dir", "clean.png");
    const result = run(
      "clean",
      pitch("Mention them.<br />They're in.") + mock(card("Can you look?")),
      out,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(out), true);
  });

  it("exits 2 when text is clipped inside a card", () => {
    const clipped = `<span style="display:block;white-space:nowrap;overflow:hidden">${"Very long clipped comment text ".repeat(4)}</span>`;
    const result = run(
      "clipped",
      pitch("Mention them.<br />They're in.") + mock(card(clipped)),
    );
    assert.equal(result.status, 2, result.stderr);
  });

  it("exits 2 when an unbroken headline word runs into the mocks", () => {
    const result = run(
      "wide-headline",
      pitch("Supercalifragilistic.<br />Done.") + mock(card("Can you look?")),
    );
    assert.equal(result.status, 2, result.stderr);
  });

  it("exits 3 when the layout check never reports", () => {
    const stall = `<script>Object.defineProperty(document, "fonts", { value: { ready: new Promise(() => {}) } });</script>`;
    const result = run(
      "no-check",
      stall + pitch("Mention them.<br />They're in.") + mock(card("Hi")),
    );
    assert.equal(result.status, 3, result.stderr);
  });

  it(
    "exits 3 offline on a machine without Inter",
    { skip: !existsSync("/usr/share/fonts/truetype/dejavu") },
    () => {
      const fonts = join(work, "fonts.conf");
      writeFileSync(
        fonts,
        `<?xml version="1.0"?><fontconfig><dir>/usr/share/fonts/truetype/dejavu</dir><cachedir>${join(work, "fc-cache")}</cachedir></fontconfig>`,
      );
      const result = run(
        "no-inter",
        pitch("Mention them.<br />They're in.") + mock(card("Hi")),
        undefined,
        {
          FONTCONFIG_FILE: fonts,
          HTTPS_PROXY: "http://127.0.0.1:9",
          https_proxy: "http://127.0.0.1:9",
        },
      );
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, /Inter did not load/);
    },
  );
});
