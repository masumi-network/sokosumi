import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { unsafeSvgReason } from "./soko-bot-svg";

const MALICIOUS_PREFIX_REPETITIONS = 40;
const WORKER_TIMEOUT_MS = 5_000;
const WHITESPACE_TEST_LENGTH = 200_000;

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

  it("accepts whitespace, an XML declaration and several adjacent comments", () => {
    expect(
      unsafeSvgReason(
        '\uFEFF \n<?XML version="1.0"?>\n<!-- first --><!-- second -->\n<SVG></SVG>',
      ),
    ).toBeNull();
  });

  it.each([
    ["an unfinished declaration", '<?xml version="1.0"'],
    ["an unfinished comment", "<!-- no closing marker"],
    ["text after a completed comment", "<!-- first -->text--><svg></svg>"],
  ])("refuses %s before the SVG root", (_label, value) => {
    expect(unsafeSvgReason(value)).toMatch(/start with/);
  });

  it.each([
    [
      "ambiguous comment boundaries",
      `<!--${"--><!--".repeat(MALICIOUS_PREFIX_REPETITIONS)}!`,
      "An SVG must start with an <svg> element",
    ],
    [
      "attribute whitespace",
      `<svg><a href=${" ".repeat(WHITESPACE_TEST_LENGTH)}x></a></svg>`,
      null,
    ],
    [
      "CSS whitespace",
      `<svg><style>x{fill:url(${" ".repeat(WHITESPACE_TEST_LENGTH)}x)}</style></svg>`,
      null,
    ],
  ])(
    "handles %s without blocking the worker",
    async (_label, input, expected) => {
      const worker = new Worker(
        `const {parentPort, workerData} = require("node:worker_threads");
       const check = (${unsafeSvgReason.toString()});
       parentPort.postMessage(check(workerData));`,
        { eval: true, execArgv: [], workerData: input },
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await new Promise<string | null>((resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("SVG validation blocked the worker")),
            WORKER_TIMEOUT_MS,
          );
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        expect(result).toBe(expected);
      } finally {
        clearTimeout(timeout);
        await worker.terminate();
      }
    },
    WORKER_TIMEOUT_MS * 2,
  );

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
    [
      "a spaced quoted link",
      '<svg><a href = " \n javascript:alert(1)"></a></svg>',
    ],
    [
      "a spaced quoted CSS URL",
      '<svg><style>x{fill:url( " \n https://example.test/x )}</style></svg>',
    ],
  ])("refuses %s", (_label, svg) => {
    expect(unsafeSvgReason(svg)).not.toBeNull();
  });
});
