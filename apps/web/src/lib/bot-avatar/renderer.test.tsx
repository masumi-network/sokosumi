import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarModel } from "./model";

const model = {
  size: 8,
  face: document.createElement("canvas"),
  eyes: document.createElement("canvas"),
  height: new Uint8Array(64),
  f0: 0.1,
  fs: 0.8,
  rz: 0.1,
  pivot: [0.5, 0.5],
  bg: [1, 1, 1],
  eyeList: [],
} as AvatarModel;

/** A WebGL context that accepts everything, so the draw path runs without a GPU. */
const fakeGl = () =>
  new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key === "string" && /^[A-Z][A-Z0-9_]+$/.test(key)
          ? 1
          : () => ({}),
    },
  );

let webgl: unknown;
const draws = vi.fn();

beforeEach(() => {
  vi.resetModules();
  webgl = fakeGl();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) => (kind === "webgl" ? webgl : { drawImage: draws })) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  draws.mockClear();
});

async function avatar() {
  const { createLiveAvatar } = await import("./renderer");
  return createLiveAvatar(document.createElement("canvas"), {
    seed: 1,
    state: "idle",
    onFail: vi.fn(),
  });
}

describe("createLiveAvatar", () => {
  it("is null without WebGL, so the caller keeps the still picture", async () => {
    webgl = null;
    expect(await avatar()).toBeNull();
  });

  it("draws nothing while off screen, and loops once it is visible", async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const live = await avatar();
    live?.setModel(model);
    expect(raf).not.toHaveBeenCalled();
    live?.setVisible(true);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("stops the loop when the last avatar leaves the screen", async () => {
    let frame: FrameRequestCallback = () => {};
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const live = await avatar();
    live?.setModel(model);
    live?.setVisible(true);
    frame(16);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(2);
    live?.setVisible(false);
    frame(32);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it("draws the rest pose once, without a loop, under reduced motion", async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const live = await avatar();
    live?.setModel(model);
    live?.setVisible(true);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
  });
});
