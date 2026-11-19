import { afterEach, describe, expect, it, vi } from "vitest";

import { findSections } from "./site-capture";

const SCREEN = { width: 1440, height: 900 };

interface Fake {
  tagName: string;
  id: string;
  className: string;
  children: Fake[];
  scrollHeight: number;
  innerText: string;
  box: { top: number; width: number; height: number };
  getBoundingClientRect: () => { top: number; width: number; height: number };
  closest: () => null;
  querySelector: (selector: string) => Fake | null;
  querySelectorAll: () => Fake[];
}

/** A block of the page: its box, and how far its content runs. */
function block(
  box: { top: number; height: number; width?: number },
  children: Fake[] = [],
  options: { scrollHeight?: number; heading?: string } = {},
): Fake {
  const heading = options.heading
    ? block({ top: box.top, height: 40 }, [], {})
    : null;
  if (heading) heading.innerText = options.heading as string;
  const fake: Fake = {
    tagName: "DIV",
    id: "",
    className: "",
    children,
    scrollHeight: options.scrollHeight ?? box.height,
    innerText: options.heading ?? "",
    box: { width: SCREEN.width, ...box },
    getBoundingClientRect: () => fake.box,
    closest: () => null,
    querySelector: (selector) => (selector.startsWith("h1") ? heading : null),
    querySelectorAll: () => [],
  };
  return fake;
}

function onPage(body: Fake) {
  vi.stubGlobal("window", { innerHeight: SCREEN.height, scrollY: 0 });
  vi.stubGlobal("document", {
    body,
    documentElement: { clientWidth: SCREEN.width },
  });
  vi.stubGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible",
    position: "static",
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findSections", () => {
  it("opens a screen-high wrapper whose content runs past it", () => {
    // buttondown.com: `h-full` keeps the wrapper one screen high.
    const sections = [
      block({ top: 0, height: 700 }, [], { heading: "Why is it hard?" }),
      block({ top: 700, height: 600 }, [], { heading: "Focused on you" }),
      block({ top: 1300, height: 800 }, [], { heading: "For businesses" }),
    ];
    onPage(
      block({ top: 0, height: 0 }, [
        block({ top: 0, height: SCREEN.height }, sections, {
          scrollHeight: 2100,
        }),
      ]),
    );
    expect(findSections(220, 10).map((section) => section.title)).toEqual([
      "Why is it hard?",
      "Focused on you",
      "For businesses",
    ]);
  });

  it("keeps a block of about a screen whole", () => {
    onPage(
      block({ top: 0, height: 0 }, [
        block({ top: 0, height: 800 }, [block({ top: 0, height: 400 })], {
          heading: "One hero",
        }),
      ]),
    );
    expect(findSections(220, 10)).toEqual([
      { kind: "hero", title: "One hero", y: 0, height: 800 },
    ]);
  });
});
