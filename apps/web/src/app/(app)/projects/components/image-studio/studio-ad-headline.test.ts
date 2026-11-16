import { StudioLogoPosition } from "@sokosumi/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = new Blob(["ad"], { type: "image/png" });
const OUTPUT = new Blob(["headline"], { type: "image/png" });
const GOOGLE_CSS = `
  @font-face {
    src: url(https://fonts.gstatic.com/brand-latin.woff2) format('woff2');
    unicode-range: U+0000-00FF;
  }
  @font-face {
    src: url(https://fonts.gstatic.com/brand-extended.woff2) format('woff2');
    unicode-range: U+0100-024F;
  }
`;

function canvasHarness() {
  const styles: string[] = [];
  const context = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * Number.parseInt(context.font.slice(4), 10) * 0.5,
    })),
    fillRect: vi.fn(() => styles.push(context.fillStyle)),
    fillText: vi.fn(() => styles.push(context.fillStyle)),
  };
  const bitmap = { width: 1080, height: 1350, close: vi.fn() };
  const add = vi.fn();
  const canvas = {
    getContext: () => context,
    toBlob: (callback: BlobCallback) => callback(OUTPUT),
  };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal("document", {
    createElement: () => canvas,
    fonts: { add },
    documentElement: {},
  });
  const theme = vi.fn(() => ({
    getPropertyValue: (token: string) =>
      token === "--media-ground" ? "theme-panel" : "theme-text",
  }));
  vi.stubGlobal("getComputedStyle", theme);
  return { context, bitmap, styles, theme, add };
}

function fontHarness() {
  const load = vi.fn().mockImplementation(function (this: FontFace) {
    return Promise.resolve(this);
  });
  const Font = vi.fn(
    class {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}
      load = load;
    },
  );
  vi.stubGlobal("FontFace", Font);
  const fetchCss = vi.fn().mockResolvedValue(new Response(GOOGLE_CSS));
  vi.stubGlobal("fetch", fetchCss);
  return { Font, load, fetchCss };
}

describe("Studio headline rendering", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses the original system font and theme only when no look is available", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context, bitmap, styles } = canvasHarness();

    expect(await renderStudioHeadline(SOURCE, "Brew at your own pace")).toBe(
      OUTPUT,
    );
    expect(context.font).toBe("700 81px system-ui");
    expect(styles).toEqual(["theme-panel", "theme-text"]);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("skips near-white text and pairs the first brand ink with the most contrasting brand panel", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { styles, theme } = canvasHarness();

    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      colors: ["#FAFAFA", "#A33421", "#141414", "#F1DDD0"],
    });

    expect(styles).toEqual(["#FAFAFA", "#A33421"]);
    expect(theme).not.toHaveBeenCalled();
  });

  it("uses a dark brand panel for a light brand ink", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { styles } = canvasHarness();
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      colors: ["#D9B782", "#17110E"],
    });
    expect(styles).toEqual(["#17110E", "#D9B782"]);
  });

  it("ignores malformed colors and accepts short hex colors", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { styles } = canvasHarness();
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      colors: ["red", "#zzzzzz", " #123 ", "#fff"],
    });
    expect(styles).toEqual(["#fff", "#123"]);
  });

  it("makes a contrasting brand shade for a single-color kit without theme tokens", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { styles, theme } = canvasHarness();
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      colors: ["#A33421"],
    });
    expect(styles).toEqual(["rgb(253, 251, 251)", "#A33421"]);
    expect(theme).not.toHaveBeenCalled();
  });

  it("falls back to theme colors if the kit has no usable hex", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { styles } = canvasHarness();
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      colors: ["invalid"],
    });
    expect(styles).toEqual(["theme-panel", "theme-text"]);
  });

  it("loads and registers the supplied font file before measuring, without a Google request", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context, add } = canvasHarness();
    const { Font, load, fetchCss } = fontHarness();
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      fonts: ["Brand Face"],
      fontUrl: "blob:uploaded-font",
    });

    expect(Font).toHaveBeenCalledWith(
      "StudioHeadline1",
      'url("blob:uploaded-font")',
      { weight: "700" },
    );
    expect(load).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(
      context.measureText.mock.invocationCallOrder[0],
    );
    expect(context.font).toBe('700 81px "StudioHeadline1", system-ui');
    expect(fetchCss).not.toHaveBeenCalled();
  });

  it("loads the first named Google family at weight 700, retaining Unicode subsets and reusing the face", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context, add } = canvasHarness();
    const { Font, fetchCss } = fontHarness();
    const look = { fonts: ["Playfair Display", "Inter"] };
    await renderStudioHeadline(SOURCE, "Brew slowly Ā", undefined, look);
    await renderStudioHeadline(SOURCE, "Brew slowly Ā", undefined, look);

    expect(String(fetchCss.mock.calls[0][0])).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display%3Awght%40700",
    );
    expect(fetchCss).toHaveBeenCalledOnce();
    expect(Font).toHaveBeenCalledWith(
      "StudioHeadline1",
      'url("https://fonts.gstatic.com/brand-extended.woff2")',
      { weight: "700", unicodeRange: "U+0100-024F" },
    );
    expect(add).toHaveBeenCalledTimes(2);
    expect(context.font).toContain('"StudioHeadline1"');
  });

  it("loads only the Unicode subsets used by the headline", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { add } = canvasHarness();
    const { Font, load } = fontHarness();
    load.mockImplementation(function (this: { source: string }) {
      return this.source.includes("extended")
        ? Promise.reject(new Error("Unused subset offline"))
        : Promise.resolve(this);
    });
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      fonts: ["Inter"],
    });
    expect(Font).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
  });

  it("tries the next named font when Google cannot supply the first", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context } = canvasHarness();
    const { fetchCss } = fontHarness();
    fetchCss.mockResolvedValueOnce(new Response(null, { status: 400 }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      fonts: ["Unknown Face", "Inter"],
    });
    expect(fetchCss).toHaveBeenCalledTimes(2);
    expect(context.font).toContain('"StudioHeadline2"');
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each(["network", "font", "untrusted source", "empty stylesheet"])(
    "still draws the brand palette after a %s failure",
    async (failure) => {
      const { renderStudioHeadline } = await import("./studio-ad-headline");
      const { context, styles } = canvasHarness();
      const { load, fetchCss } = fontHarness();
      if (failure === "network")
        fetchCss.mockRejectedValue(new Error("offline"));
      if (failure === "font") load.mockRejectedValue(new Error("invalid font"));
      if (failure === "untrusted source")
        fetchCss.mockResolvedValue(
          new Response(
            "@font-face { src: url(https://random.example/font.woff2); }",
          ),
        );
      if (failure === "empty stylesheet")
        fetchCss.mockResolvedValue(new Response(""));
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
          fonts: ["Inter"],
          colors: ["#A33421", "#fff"],
        }),
      ).resolves.toBe(OUTPUT);
      expect(context.font).toBe("700 81px system-ui");
      expect(styles).toEqual(["#fff", "#A33421"]);
      expect(warning).toHaveBeenCalledWith(
        "Studio headline font unavailable; using a fallback.",
      );
    },
  );

  it("times out a hung font and falls back without leaving a timer", async () => {
    vi.useFakeTimers();
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context, add } = canvasHarness();
    const { load } = fontHarness();
    load.mockReturnValue(new Promise(() => {}));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rendering = renderStudioHeadline(SOURCE, "Brew slowly", undefined, {
      fontUrl: "blob:hung-font",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(rendering).resolves.toBe(OUTPUT);
    expect(context.font).toBe("700 81px system-ui");
    expect(add).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves wrapping and the top logo safe area with a brand look", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { context } = canvasHarness();
    await renderStudioHeadline(
      SOURCE,
      "Brew at your own pace. Make every morning a ritual.",
      StudioLogoPosition.TOP_LEFT,
      { colors: ["#A33421", "#fff"] },
    );
    expect(context.fillRect).toHaveBeenCalledWith(
      43,
      289,
      994,
      expect.any(Number),
    );
    expect(context.fillText.mock.calls.length).toBeGreaterThan(1);
  });

  it("rejects copy that cannot fit and closes the source bitmap", async () => {
    const { renderStudioHeadline } = await import("./studio-ad-headline");
    const { bitmap } = canvasHarness();
    await expect(
      renderStudioHeadline(SOURCE, "Long headline ".repeat(1_000)),
    ).rejects.toThrow("The Studio headline does not fit");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
