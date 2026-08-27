import { describe, expect, it } from "vitest";

import {
  advanceRevealPastCompletedDataImages,
  clampRevealLengthForMarkdownDataImages,
  parseMarkdownWithDataImageSegments,
} from "./generated-image-markdown";

const pngImage = "![Generated image](data:image/png;base64,abc123==)";
const jpegImage = "![Portrait](data:image/jpeg;base64,def456==)";

describe("clampRevealLengthForMarkdownDataImages", () => {
  it("returns the desired length when there are no markdown data images", () => {
    expect(clampRevealLengthForMarkdownDataImages("Plain text", 5)).toBe(5);
  });

  it("holds at the start of a complete image when the reveal lands inside it", () => {
    const content = `Before ${pngImage} after`;
    const desiredLength = content.indexOf("abc123") + 2;
    const imageStart = content.indexOf("![");

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      imageStart,
    );
  });

  it("returns the reveal length once it reaches past the closing paren", () => {
    const content = `Before ${pngImage} after`;
    const imageEnd = content.indexOf(")") + 1;

    expect(clampRevealLengthForMarkdownDataImages(content, imageEnd)).toBe(
      imageEnd,
    );
    expect(clampRevealLengthForMarkdownDataImages(content, imageEnd + 5)).toBe(
      imageEnd + 5,
    );
  });

  it("retreats before an incomplete image while it is still streaming", () => {
    const content = "Before ![Generated image](data:image/png;base64,abc";
    const imageStart = content.indexOf("![");

    expect(
      clampRevealLengthForMarkdownDataImages(content, content.length),
    ).toBe(imageStart);
  });

  it("retreats before an incomplete case-variant data URI while streaming", () => {
    const content = "Before ![Generated image](Data:Image/PNG;Base64,abc";
    const imageStart = content.indexOf("![");

    expect(
      clampRevealLengthForMarkdownDataImages(content, content.length),
    ).toBe(imageStart);
  });

  it("handles multiple images independently", () => {
    const content = `${pngImage}\n\nBetween\n\n${jpegImage}`;
    const desiredLength = content.lastIndexOf("def456") + 3;
    const secondImageStart = content.indexOf(jpegImage);

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      secondImageStart,
    );
  });

  it("returns desired length when reveal stops in text before a later image", () => {
    const content = `${pngImage}\n\nBetween\n\n${jpegImage}`;
    const desiredLength = content.indexOf("Between") + 3;

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      desiredLength,
    );
  });

  it("does not treat a parenthesis inside alt text as the url closing paren", () => {
    const image = "![caption with ) char](data:image/png;base64,AAA==)";
    const content = `Before ${image} after`;
    const desiredLength = content.indexOf("AAA") + 2;
    const imageStart = content.indexOf("![caption with ) char]");

    expect(clampRevealLengthForMarkdownDataImages(content, desiredLength)).toBe(
      imageStart,
    );
  });
});

describe("advanceRevealPastCompletedDataImages", () => {
  it("returns the current length when there are no markdown data images", () => {
    expect(advanceRevealPastCompletedDataImages("Plain text", 5)).toBe(5);
  });

  it("returns the current length before a later image starts", () => {
    const content = `Before ${pngImage} after`;
    const currentLength = content.indexOf("Before") + 3;

    expect(advanceRevealPastCompletedDataImages(content, currentLength)).toBe(
      currentLength,
    );
  });

  it("skips to the end of a complete image when reveal lands inside it", () => {
    const content = `Before ${pngImage} after`;
    const currentLength = content.indexOf("abc123") + 2;
    const imageEnd = content.indexOf(")") + 1;

    expect(advanceRevealPastCompletedDataImages(content, currentLength)).toBe(
      imageEnd,
    );
  });

  it("does not skip an incomplete image that is still streaming", () => {
    const content = "Before ![Generated image](data:image/png;base64,abc";
    const currentLength = content.length;

    expect(advanceRevealPastCompletedDataImages(content, currentLength)).toBe(
      currentLength,
    );
  });

  it("skips the second image when reveal lands inside back-to-back images", () => {
    const content = `${pngImage}${jpegImage} after`;
    const currentLength = content.lastIndexOf("def456") + 2;
    const secondImageEnd = content.lastIndexOf(")") + 1;

    expect(advanceRevealPastCompletedDataImages(content, currentLength)).toBe(
      secondImageEnd,
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

  it("parses a complete case-variant data URI markdown image", () => {
    const dataUrl = "Data:Image/PNG;Base64,abc123==";
    expect(
      parseMarkdownWithDataImageSegments(`Caption\n\n![x](${dataUrl})\n`),
    ).toEqual([
      { type: "text", text: "Caption\n\n" },
      {
        type: "image",
        alt: "x",
        src: dataUrl,
      },
      { type: "text", text: "\n" },
    ]);
  });

  it("treats a trailing incomplete case-variant data uri as pending", () => {
    const content = "Before\n\n![Generated image](Data:Image/PNG;Base64,abc";

    expect(parseMarkdownWithDataImageSegments(content)).toEqual([
      { type: "text", text: "Before\n\n" },
      { type: "pending-image", alt: "Generated image" },
    ]);
  });
});
