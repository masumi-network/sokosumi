import { describe, expect, it } from "vitest";
import { unsafeSvgReason } from "./soko-bot-svg";

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
