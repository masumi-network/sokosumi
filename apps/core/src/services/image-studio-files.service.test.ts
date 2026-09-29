import { describe, expect, it } from "vitest";

import { imageFileName } from "@/services/image-studio-files.service";

describe("imageFileName", () => {
  it("slugs the prompt and keeps the job id so names never collide", () => {
    expect(
      imageFileName("A red fox, in the snow!", "3f2a9c1d-0000", "image/jpeg"),
    ).toBe("a-red-fox-in-the-snow-3f2a9c1d.jpg");
  });

  it("falls back to a plain name and png for an empty prompt or odd type", () => {
    expect(imageFileName("!!!", "abcdef12-0", "image/x-weird")).toBe(
      "image-abcdef12.png",
    );
  });
});
