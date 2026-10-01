// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Mascot } from "./mascot";

const state = vi.hoisted(() => ({
  failCreation: false,
  failRender: false,
  renderers: [] as {
    canvas: HTMLCanvasElement;
    frame: (() => void) | null;
    scene?: import("three").Scene;
    dispose: ReturnType<typeof vi.fn>;
    forceContextLoss: ReturnType<typeof vi.fn>;
  }[],
  load: vi.fn(),
  roomDispose: vi.fn(),
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      record = {
        canvas: this.domElement,
        frame: null as (() => void) | null,
        scene: undefined as import("three").Scene | undefined,
        dispose: vi.fn(),
        forceContextLoss: vi.fn(),
      };
      constructor() {
        if (state.failCreation) throw new Error("No WebGL");
        state.renderers.push(this.record);
      }
      setPixelRatio() {}
      setSize() {}
      setAnimationLoop(frame: (() => void) | null) {
        this.record.frame = frame;
      }
      render(scene: import("three").Scene) {
        if (state.failRender) throw new Error("Render failed");
        this.record.scene = scene;
      }
      dispose() {
        this.record.dispose();
      }
      forceContextLoss() {
        this.record.forceContextLoss();
      }
    },
    PMREMGenerator: class {
      fromScene() {
        return { texture: new actual.Texture(), dispose: vi.fn() };
      }
      dispose() {}
    },
  };
});

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = state.load;
  },
}));
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({
  RoomEnvironment: class {
    dispose = state.roomDispose;
  },
}));

let root: Root;
let host: HTMLDivElement;
let model: THREE.Group;
let geometryDispose: ReturnType<typeof vi.fn>;
let materialDispose: ReturnType<typeof vi.fn>;
let bitmapClose: ReturnType<typeof vi.fn>;
const media = { matches: false };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => media);
  media.matches = false;
  state.failCreation = false;
  state.failRender = false;
  state.renderers = [];
  state.roomDispose.mockClear();
  model = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  class FixtureBitmap {
    close = vi.fn();
  }
  vi.stubGlobal("ImageBitmap", FixtureBitmap);
  const bitmap = new FixtureBitmap();
  bitmapClose = bitmap.close;
  material.map = new THREE.Texture(bitmap);
  geometryDispose = vi.spyOn(geometry, "dispose");
  materialDispose = vi.spyOn(material, "dispose");
  model.add(new THREE.Mesh(geometry, material));
  state.load.mockReset().mockResolvedValue({ scene: model });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(<Mascot />);
    // The component intentionally awaits three separate lazy modules.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function ready() {
  return host.querySelector(".mascot")?.getAttribute("data-ready");
}

describe("mascot lifecycle", () => {
  it("returns to the still and releases resources after context loss", async () => {
    await mount();
    expect(ready()).toBe("true");
    const renderer = state.renderers[0];
    await act(() =>
      renderer.canvas.dispatchEvent(new Event("webglcontextlost")),
    );
    expect(ready()).toBe("false");
    expect(host.querySelector("canvas")).toBeNull();
    expect(renderer.frame).toBeNull();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(state.roomDispose).toHaveBeenCalledOnce();
  });

  it("keeps the still when renderer creation fails and disposes the loaded model", async () => {
    state.failCreation = true;
    await mount();
    expect(ready()).toBe("false");
    expect(host.querySelector("canvas")).toBeNull();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("returns to the still after a rendering error", async () => {
    await mount();
    state.failRender = true;
    await act(() => state.renderers[0].frame?.());
    expect(ready()).toBe("false");
    expect(state.renderers[0].dispose).toHaveBeenCalledOnce();
  });

  it("disposes a model that loads after unmount without creating a renderer", async () => {
    let finish: ((gltf: { scene: THREE.Group }) => void) | undefined;
    state.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    expect(state.load).toHaveBeenCalled();
    await act(() => root.unmount());
    await act(async () => {
      finish?.({ scene: model });
    });
    expect(state.renderers).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    root = createRoot(host);
  });

  it("keeps the still after a failed asset download", async () => {
    state.load.mockRejectedValue(new Error("Download failed"));
    await mount();
    expect(ready()).toBe("false");
    expect(state.renderers).toHaveLength(0);
  });

  it("pauses both pointer tracking and bobbing and honors runtime reduced motion", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    await mount();
    const renderer = state.renderers[0];
    const pivot = renderer.scene?.children[0];
    expect(pivot).toBeDefined();
    now.mockReturnValue(1800);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 600, clientY: 400 }),
    );
    renderer.frame?.();
    expect(pivot?.rotation.y).not.toBe(0);
    expect(pivot?.position.y).not.toBe(0);
    await act(() => host.querySelector("button")?.click());
    renderer.frame?.();
    expect(pivot?.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(pivot?.position.y).toBe(0);
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("Resume animation");
    // The label carries the state, so aria-pressed would announce it twice.
    expect(button?.hasAttribute("aria-pressed")).toBe(false);
    await act(() => host.querySelector("button")?.click());
    media.matches = true;
    renderer.frame?.();
    expect(pivot?.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(pivot?.position.y).toBe(0);
    media.matches = false;
    renderer.frame?.();
    expect(pivot?.rotation.y).not.toBe(0);
    now.mockRestore();
  });
});
