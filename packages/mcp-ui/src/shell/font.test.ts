import { afterEach, describe, expect, it, vi } from "vitest";
import { FONT_FAMILY, loadFont } from "./font.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

describe("loadFont", () => {
  it("adds the embedded Inter to the document from bytes, with no fetch", () => {
    const added: { family: string; bytes: Uint8Array; weight?: string }[] = [];
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          public family: string,
          public bytes: Uint8Array,
          descriptors: { weight?: string },
        ) {
          added.push({ family, bytes, weight: descriptors.weight });
        }
      },
    );
    const add = vi.fn();
    Object.defineProperty(document, "fonts", {
      value: { add },
      configurable: true,
    });

    loadFont();

    expect(add).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
    expect(added[0].family).toBe(FONT_FAMILY);
    expect(added[0].weight).toBe("400 700");
    // A WOFF2 file starts with "wOF2".
    expect(String.fromCharCode(...added[0].bytes.slice(0, 4))).toBe("wOF2");
  });

  it("does nothing where the browser has no FontFace", () => {
    vi.stubGlobal("FontFace", undefined);
    expect(() => loadFont()).not.toThrow();
  });
});
