import { describe, expect, it } from "vitest";

describe("happy-dom WAAPI cancel AbortError", () => {
  it("does not surface Animation.cancel() as an unhandled rejection", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], 1000);
    expect(animation.playState).toBe("running");
    animation.cancel();
    await expect(animation.finished).rejects.toMatchObject({
      name: "AbortError",
      message: "The animation was canceled.",
    });
    element.remove();
  });
});
