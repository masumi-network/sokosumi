import { describe, expect, it } from "vitest";

import { SHORT_VIDEO_FORMATS } from "./talking-video-credits.js";
import {
  VIDEO_RECIPES,
  VIDEO_SHAPE_FRAMES,
  videoRecipeFor,
  videoShapesFor,
} from "./video-recipes.js";

describe("video recipes", () => {
  it("has a recipe for the presenter and every short format", () => {
    expect(videoRecipeFor(null).kind).toBe("presenter");
    for (const format of SHORT_VIDEO_FORMATS) {
      expect(videoRecipeFor(format).kind).toBe(format);
    }
    expect(VIDEO_RECIPES.slideshow.spoken).toBe(false);
    expect(VIDEO_RECIPES.voiceover.spoken).toBe(true);
  });

  it("keeps every frame even, as the encoder needs", () => {
    for (const { width, height } of Object.values(VIDEO_SHAPE_FRAMES)) {
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });

  it("keeps only the shapes a recipe reads well in, and falls back to vertical", () => {
    expect(videoShapesFor(VIDEO_RECIPES.site_tour, ["16:9", "1:1"])).toEqual([
      "16:9",
    ]);
    expect(videoShapesFor(VIDEO_RECIPES.site_tour, ["1:1"])).toEqual(["9:16"]);
    expect(
      videoShapesFor(VIDEO_RECIPES.presenter, ["16:9", "9:16", "4:5"]),
    ).toEqual(["9:16", "4:5", "16:9"]);
  });
});
