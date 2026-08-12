/**
 * Feedback loop for the agent-detail → gallery soft-nav padding leak.
 *
 * Minimal repro of Next.js Instant Navigations / React Activity:
 * the agent-detail layout marker stays in the DOM as `display: none`,
 * while the gallery is visible under the same `main`.
 *
 * Symptom (user): after soft-nav back to `/agents`, `main` horizontal
 * padding collapses to 0.
 *
 * Run: pnpm --filter web test src/app/__tests__/agent-fullbleed-activity-leak.harness.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const GLOBALS_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../globals.css",
);

const BASE_MAIN = `
  main[data-app-main] {
    padding: 16px;
  }
`;

/** Pre-#3786 / reverted strategy — keys off a marker that Activity can leave hidden. */
const HAS_FULLBLEED_CSS = `
  ${BASE_MAIN}
  main[data-app-main]:has([data-agent-fullbleed]) {
    padding: 0 !important;
  }
`;

/** Current strategy — keys off body attr cleared by AgentFullbleedEffect cleanup. */
const BODY_FULLBLEED_CSS = `
  ${BASE_MAIN}
  body[data-agent-fullbleed="true"] main[data-app-main] {
    padding: 0 !important;
  }
`;

function mount(css: string, options: { bodyAttr?: string; leftover: boolean }) {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.body.removeAttribute("data-agent-fullbleed");

  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  if (options.bodyAttr !== undefined) {
    document.body.setAttribute("data-agent-fullbleed", options.bodyAttr);
  }

  const main = document.createElement("main");
  main.setAttribute("data-app-main", "");
  main.innerHTML = options.leftover
    ? `<div>gallery</div><div style="display:none" data-agent-fullbleed>activity leftover</div>`
    : `<div>gallery</div>`;
  document.body.append(main);

  return main;
}

describe("agent fullbleed Activity leftover harness", () => {
  it("RED: :has strategy zeroes main padding when Activity leaves a hidden marker", () => {
    const main = mount(HAS_FULLBLEED_CSS, { leftover: true });
    expect(getComputedStyle(main).paddingLeft).toBe("0px");
  });

  it("GREEN: body-attr strategy keeps gallery padding when body attr is cleared", () => {
    const main = mount(BODY_FULLBLEED_CSS, { leftover: true });
    expect(getComputedStyle(main).paddingLeft).toBe("16px");
  });

  it("GREEN: body-attr still fullbleeds when body attr is set (detail active)", () => {
    const main = mount(BODY_FULLBLEED_CSS, {
      bodyAttr: "true",
      leftover: false,
    });
    main.innerHTML = `<div data-agent-fullbleed>detail</div>`;
    expect(getComputedStyle(main).paddingLeft).toBe("0px");
  });

  it("globals.css ships the body-attr strategy, not :has", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).toContain('body[data-agent-fullbleed="true"]');
    expect(css).not.toMatch(/:has\(\[data-agent-fullbleed\]\)/);
  });
});
