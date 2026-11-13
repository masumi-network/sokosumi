import { describe, expect, it } from "vitest";
import { unsafeSvgReason } from "./soko-bot-svg";

/** The fixed pattern takes well under 1 ms; the old one took seconds. */
const SLOW_MS = 500;

const card = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <rect width="400" height="200" fill="#fff"/>
  <text x="20" y="40" font-family="Inter">Merged today: 4</text>
</svg>`;

describe("unsafeSvgReason", () => {
  it("accepts a graphic drawn inline", () => {
    expect(unsafeSvgReason(card)).toBeNull();
    expect(
      unsafeSvgReason(`<!-- PR summary -->\n${card.slice(22)}`),
    ).toBeNull();
  });

  it("refuses anything that is not an svg", () => {
    expect(unsafeSvgReason("<html><svg></svg></html>")).toMatch(/start with/);
    // A comment ends at its first "-->": text after it is not hidden in a longer comment.
    expect(unsafeSvgReason("<!-- a --> text <!-- b --><svg></svg>")).toMatch(
      /start with/,
    );
  });

  it("reads many comment ends in linear time (CodeQL js/redos)", () => {
    // The old lazy comment pattern took seconds here and doubled with each repeat.
    const start = performance.now();
    expect(unsafeSvgReason(`<!--${"--><!--".repeat(30)}`)).toMatch(
      /start with/,
    );
    expect(performance.now() - start).toBeLessThan(SLOW_MS);
  });

  it.each([
    ["a script", "<svg><script>alert(1)</script></svg>"],
    ["embedded HTML", "<svg><foreignObject><div/></foreignObject></svg>"],
    ["an event handler", '<svg onload="alert(1)"></svg>'],
    [
      "a javascript link",
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    ],
    [
      "an outside image",
      '<svg><image href="https://example.com/t.png"/></svg>',
    ],
    [
      "an outside image by xlink",
      '<svg><image xlink:href="//example.com/t.png"/></svg>',
    ],
    [
      "an outside font",
      "<svg><style>@font-face{src:url(https://x.io/f.woff)}</style></svg>",
    ],
  ])("refuses %s", (_label, svg) => {
    expect(unsafeSvgReason(svg)).not.toBeNull();
  });
});
