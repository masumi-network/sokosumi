import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "../(app)/chat/chat-message-list-scroller";

const GLOBALS_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../globals.css",
);

/** Drop block + line comments so explanatory prose cannot false-pass. */
function cssWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function appScrollbarBody(): string {
  const css = cssWithoutComments(readFileSync(GLOBALS_CSS, "utf8"));
  const start = css.indexOf("@utility app-scrollbar {");
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("`@utility app-scrollbar` block is unterminated");
}

describe("the app-scrollbar utility", () => {
  it("only paints over the platform scrollbar where that is safe", () => {
    // High contrast and forced colors keep the platform's own scrollbar; the
    // WebKit geometry only applies where those pseudo-elements exist at all.
    const body = appScrollbarBody();

    expect(body).toContain(
      "@media (forced-colors: none) and (prefers-contrast: no-preference)",
    );
    expect(body).toContain("@supports selector(::-webkit-scrollbar)");
    expect(body.indexOf("::-webkit-scrollbar")).toBeGreaterThan(
      body.indexOf("@supports selector(::-webkit-scrollbar)"),
    );
  });

  it("draws the thumb from the theme tokens, never a literal color", () => {
    const body = appScrollbarBody();

    expect(body).toContain("background-color: var(--scrollbar-thumb)");
    expect(body).toContain("background-color: var(--muted-foreground)");
    expect(body).toContain("background-color: var(--foreground)");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("is a Tailwind utility, so a per-state hide can still outrank it", () => {
    // `@utility` lands in the utilities layer. A plain class in globals.css
    // would be unlayered and would beat the sidebar rail's hide outright.
    const css = cssWithoutComments(readFileSync(GLOBALS_CSS, "utf8"));

    expect(css).not.toMatch(/^\s*\.app-scrollbar\b/m);
  });
});

describe("scroll ports that opt in", () => {
  it("styles the chat message list instead of hand-rolling a thumb", () => {
    expect(CHAT_MESSAGE_LIST_SCROLLER_CLASS).toContain("app-scrollbar");
    expect(CHAT_MESSAGE_LIST_SCROLLER_CLASS).not.toContain(
      "::-webkit-scrollbar",
    );
  });
});
