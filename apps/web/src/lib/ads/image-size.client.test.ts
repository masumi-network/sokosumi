import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileImageSize, readImageSize } from "./image-size.client";

/** A stand-in for the browser's `Image`: the test decides how loading ends. */
class FakeImage {
  static last: FakeImage | undefined;
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";

  constructor() {
    FakeImage.last = this;
  }

  load(width: number, height: number): void {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  FakeImage.last = undefined;
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readImageSize", () => {
  it("resolves with the natural size once the picture loads", async () => {
    const reading = readImageSize("https://example.com/a.png");

    expect(FakeImage.last?.src).toBe("https://example.com/a.png");
    FakeImage.last?.load(1200, 628);

    await expect(reading).resolves.toEqual({ width: 1200, height: 628 });
  });

  it("rejects when the picture cannot be loaded", async () => {
    const reading = readImageSize("https://example.com/broken.png");

    FakeImage.last?.fail();

    await expect(reading).rejects.toThrow("Failed to read the image");
  });
});

describe("readFileImageSize", () => {
  function stubObjectUrls() {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:file-1");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    return { create, revoke };
  }

  it("reads the file through an object URL and revokes it afterwards", async () => {
    const { create, revoke } = stubObjectUrls();
    const file = new File(["x"], "a.png", { type: "image/png" });

    const reading = readFileImageSize(file);
    expect(create).toHaveBeenCalledWith(file);
    expect(FakeImage.last?.src).toBe("blob:file-1");
    expect(revoke).not.toHaveBeenCalled();
    FakeImage.last?.load(600, 600);

    await expect(reading).resolves.toEqual({ width: 600, height: 600 });
    expect(revoke).toHaveBeenCalledWith("blob:file-1");
  });

  it("revokes the object URL when the picture cannot be read", async () => {
    const { revoke } = stubObjectUrls();

    const reading = readFileImageSize(new File(["x"], "a.png"));
    FakeImage.last?.fail();

    await expect(reading).rejects.toThrow("Failed to read the image");
    expect(revoke).toHaveBeenCalledWith("blob:file-1");
  });
});
