import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { StripCoworker } from "../coworker-strip.client";
import { isOverflowStripGapPeekSafe } from "../peek-safe-strip-gap";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import { CoworkerStrip } from "../coworker-strip.client";

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

const observerCallbacks = new Set<ResizeObserverCallback>();

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observerCallbacks.add(callback);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    observerCallbacks.delete(this.callback);
  }
}

function flushResizeObservers(): void {
  for (const callback of observerCallbacks) {
    callback([], {} as ResizeObserver);
  }
}

function buildStripCoworker(
  overrides: Partial<StripCoworker> & Pick<StripCoworker, "id" | "name">,
): StripCoworker {
  return {
    imageUrl: null,
    title: null,
    ...overrides,
  };
}

beforeAll(() => {
  global.ResizeObserver =
    ResizeObserverMock as unknown as typeof global.ResizeObserver;
});

describe("CoworkerStrip", () => {
  afterEach(() => {
    cleanup();
    observerCallbacks.clear();
  });

  it("keeps the scrollport column-bounded so the w-max track cannot widen parents", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "a", name: "A" }),
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "b", name: "B" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.className).toMatch(/w-full/);
    expect(scroll.className).toMatch(/min-w-0/);
    expect(scroll.className).toMatch(/max-w-full/);
    expect(scroll.className).toMatch(/overflow-x-auto/);
    // Scrollport itself must not add page inset — landing pads elsewhere.
    expect(scroll.className).not.toMatch(/px-\d/);

    const track = screen.getByTestId("coworker-strip-track");
    expect(track.className).toMatch(/w-max/);
    expect(track.className).toMatch(/gap-\[length:var\(--strip-gap,/);
  });

  it("sets peek-safe --strip-gap when the strip overflows", () => {
    const rootFontSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el: Element) => {
        if (el === document.documentElement) {
          return { fontSize: "16px" } as CSSStyleDeclaration;
        }
        return {
          fontSize: "16px",
          columnGap: "16px",
          gap: "16px",
        } as CSSStyleDeclaration;
      });

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "a", name: "A" }),
          buildStripCoworker({ id: "b", name: "B" }),
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "c", name: "C" }),
          buildStripCoworker({ id: "d", name: "D" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
        size="compact"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    const track = screen.getByTestId("coworker-strip-track");

    // Preferred compact gap 16px fails peek-safe at Vp=288 / itemW=80
    // (d=104, rem=8 < 16). Overflow + adjust must set --strip-gap.
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      get: () => 288,
    });
    Object.defineProperty(scroll, "scrollWidth", {
      configurable: true,
      get: () => 900,
    });

    const firstChip = track.querySelector("[data-coworker-id]") as HTMLElement;
    firstChip.getBoundingClientRect = () =>
      ({
        width: 80,
        height: 80,
        top: 0,
        left: 0,
        right: 80,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    flushResizeObservers();

    const gapVar = track.style.getPropertyValue("--strip-gap");
    expect(gapVar).toMatch(/px$/);
    const gapPx = Number.parseFloat(gapVar);
    expect(gapPx).toBeGreaterThan(0);
    expect(gapPx).toBeLessThanOrEqual(16 * 1.5 + 1e-9);
    expect(isOverflowStripGapPeekSafe(288, 80, gapPx)).toBe(true);

    rootFontSpy.mockRestore();
  });

  it("clears --strip-gap when the catalog fits without overflow", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    const track = screen.getByTestId("coworker-strip-track");

    track.style.setProperty("--strip-gap", "22px");

    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(scroll, "scrollWidth", {
      configurable: true,
      get: () => 400,
    });

    flushResizeObservers();

    expect(track.style.getPropertyValue("--strip-gap")).toBe("");
  });

  it("shows every coworker name and specialty in the DOM", () => {
    const coworkers = [
      buildStripCoworker({
        id: "elena",
        name: "Elena",
        title: "Project Manager",
      }),
      buildStripCoworker({
        id: "hannah",
        name: "Hannah",
        title: "Research",
      }),
      buildStripCoworker({
        id: "alex",
        name: "Alex",
        title: "Data",
      }),
    ];

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={coworkers}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    for (const name of ["Elena", "Hannah", "Alex"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const title of ["Project Manager", "Research", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("keeps a data hook for the centered coworker", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "a", name: "A" }),
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "b", name: "B" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.querySelector('[data-coworker-id="elena"]')).toBeTruthy();
  });

  it("selects a coworker on tap without opening a room and centers that face", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah", title: "Ops" }),
        ]}
        onSelect={onSelect}
        selectedId="elena"
      />,
    );

    scrollIntoView.mockClear();

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("hannah");
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ inline: "center" }),
    );
  });

  it("selects the coworker nearest the scrollport center while scrolling", () => {
    const onSelect = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "deckster", name: "Deckster" }),
          buildStripCoworker({ id: "apol", name: "Apol" }),
          buildStripCoworker({ id: "elena", name: "Elena" }),
        ]}
        onSelect={onSelect}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    scroll.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 300,
        top: 0,
        height: 80,
        right: 300,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    function place(id: string, left: number, width: number): void {
      const node = scroll.querySelector(
        `[data-coworker-id="${id}"]`,
      ) as HTMLElement;
      node.getBoundingClientRect = () =>
        ({
          left,
          width,
          top: 0,
          height: 80,
          right: left + width,
          bottom: 80,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    // Viewport center at 150; Apol centered there.
    place("deckster", -40, 80);
    place("apol", 110, 80);
    place("elena", 260, 80);

    onSelect.mockClear();
    fireEvent.scroll(scroll);

    expect(onSelect).toHaveBeenCalledWith("apol");
  });

  it("keeps a stable chip width so selection reflow cannot move centers", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
        size="compact"
      />,
    );

    const options = screen.getAllByRole("option");
    for (const option of options) {
      expect(option.className).toMatch(/w-\[5\.5rem\]/);
    }
  });

  it("marks the selected coworker as aria-selected", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah" }),
        ]}
        onSelect={vi.fn()}
        selectedId="hannah"
      />,
    );

    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Elena"}',
      }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("reserves two title lines on every chip so 1-line vs 2-line captions cannot resize the row", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({
            id: "elena",
            name: "Elena",
            title: "Strategy",
          }),
          buildStripCoworker({
            id: "pheme",
            name: "Pheme",
            title: "Communications and media outreach",
          }),
          buildStripCoworker({
            id: "deckster",
            name: "Deckster",
            title: null,
          }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const titles = screen.getAllByTestId("coworker-strip-title");
    expect(titles).toHaveLength(3);

    for (const title of titles) {
      expect(title.className).toMatch(/line-clamp-2/);
      expect(title.className).toMatch(/min-h-\[2lh\]/);
    }

    expect(titles[0]).toHaveTextContent("Strategy");
    expect(titles[1]).toHaveTextContent("Communications and media outreach");
    // Empty title stays mounted (nbsp) so chip height matches the others.
    expect(titles[2]?.textContent).toBe("\u00a0");
  });

  it("keeps the same title min-height class in compact size", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena", title: "Ops" }),
          buildStripCoworker({
            id: "pheme",
            name: "Pheme",
            title: "Long specialty that wraps",
          }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
        size="compact"
      />,
    );

    for (const title of screen.getAllByTestId("coworker-strip-title")) {
      expect(title.className).toMatch(/min-h-\[2lh\]/);
      expect(title.className).toMatch(/line-clamp-2/);
    }
  });
});
