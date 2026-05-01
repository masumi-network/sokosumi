import { describe, expect, it } from "vitest";

import {
  clampRevealLengthForMarkdownDataImages,
  parseMarkdownWithDataImageSegments,
} from "../generated-image-markdown";

const pngImage = "![Generated image](data:image/png;base64,abc123==)";
const jpegImage = "![Portrait](data:image/jpeg;base64,def456==)";

describe("clampRevealLengthForMarkdownDataImages", () => {
  it("returns the desired length when there are no markdown data images", () => {
    expect(clampRevealLengthForMarkdownDataImages("Plain text", 5)).toBe(5);
  });

  it("advances to the end of a complete image when the reveal lands inside it", () => {
    const content = `Before ${pngImage} after`;
    const desiredLength = content.indexOf("abc123") + 2;
    const imageEnd = content.indexOf(")") + 1;

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      imageEnd,
    );
  });

  it("retreats before an incomplete image while it is still streaming", () => {
    const content = "Before ![Generated image](data:image/png;base64,abc";
    const imageStart = content.indexOf("![");

    expect(
      clampRevealLengthForMarkdownDataImages(content, content.length),
    ).toBe(imageStart);
  });

  it("handles multiple images independently", () => {
    const content = `${pngImage}\n\nBetween\n\n${jpegImage}`;
    const desiredLength = content.lastIndexOf("def456") + 3;
    const imageEnd = content.lastIndexOf(")") + 1;

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      imageEnd,
    );
  });
});

describe("parseMarkdownWithDataImageSegments", () => {
  it("splits complete data images from surrounding markdown text", () => {
    expect(
      parseMarkdownWithDataImageSegments(`Before\n\n${pngImage}\n\nAfter`),
    ).toEqual([
      { type: "text", text: "Before\n\n" },
      {
        type: "image",
        alt: "Generated image",
        src: "data:image/png;base64,abc123==",
      },
      { type: "text", text: "\n\nAfter" },
    ]);
  });

  it("normalizes whitespace from streamed base64 image sources", () => {
    const content = "![Generated image](data:image/png;base64,abc\n123==)";

    expect(parseMarkdownWithDataImageSegments(content)).toEqual([
      {
        type: "image",
        alt: "Generated image",
        src: "data:image/png;base64,abc123==",
      },
    ]);
  });

  it("turns a trailing incomplete data image into a pending image segment", () => {
    const content = "Before\n\n![Generated image](data:image/png;base64,abc";

    expect(parseMarkdownWithDataImageSegments(content)).toEqual([
      { type: "text", text: "Before\n\n" },
      { type: "pending-image", alt: "Generated image" },
    ]);
  });
});
