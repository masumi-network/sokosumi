import {
  type AvatarLook,
  type AvatarState,
  formatAvatarCode,
  originalAvatarLook,
} from "@sokosumi/soko-bot";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Activity, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvatarModel } from "@/lib/bot-avatar/model";
import type { LiveAvatar } from "@/lib/bot-avatar/renderer";
import { useLiveBotAvatar } from "./use-live-bot-avatar";

const loadAvatarModelMock = vi.hoisted(() =>
  vi.fn<(look: AvatarLook, code: string, px: number) => Promise<AvatarModel>>(),
);
const createLiveAvatarMock = vi.hoisted(() =>
  vi.fn<
    (
      canvas: HTMLCanvasElement,
      opts: { seed: number; state: AvatarState; onFail: () => void },
    ) => LiveAvatar | null
  >(),
);

vi.mock("@/lib/bot-avatar/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot-avatar/load")>();
  return {
    ...actual,
    loadAvatarModel: loadAvatarModelMock,
  };
});

vi.mock("@/lib/bot-avatar/renderer", () => ({
  createLiveAvatar: createLiveAvatarMock,
}));

const LOOK = originalAvatarLook("fox");
const CODE = formatAvatarCode(LOOK);
const FAKE_MODEL = { size: 64 } as unknown as AvatarModel;

function createMockHandle(): LiveAvatar {
  return {
    setModel: vi.fn(),
    setState: vi.fn(),
    setLook: vi.fn(),
    setVisible: vi.fn(),
    destroy: vi.fn(),
  };
}

interface HarnessProps {
  code?: string;
  look?: AvatarLook | null;
  state?: AvatarState;
  size?: number;
  gaze?: boolean;
}

function Harness({
  code = CODE,
  look = LOOK,
  state = "idle",
  size = 128,
  gaze = false,
}: HarnessProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ready, failed } = useLiveBotAvatar(canvasRef, {
    code,
    look,
    state,
    size,
    gaze,
  });

  return (
    <div data-failed={failed} data-ready={ready}>
      {look && !failed ? <canvas ref={canvasRef} /> : null}
    </div>
  );
}

describe("useLiveBotAvatar", () => {
  let intersect: (entries: { isIntersecting: boolean }[]) => void;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  let observeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    loadAvatarModelMock.mockReset();
    createLiveAvatarMock.mockReset();
    intersect = () => {};
    disconnectSpy = vi.fn();
    observeSpy = vi.fn();

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          intersect = callback;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks failed when WebGL renderer creation returns null", () => {
    createLiveAvatarMock.mockReturnValue(null);
    const { container } = render(<Harness />);

    expect(container.firstElementChild).toHaveAttribute("data-failed", "true");
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("loads the model, wires intersection visibility, updates state without recreating, and cleans up", async () => {
    const handle = createMockHandle();
    const deferred = Promise.withResolvers<AvatarModel>();
    createLiveAvatarMock.mockReturnValue(handle);
    loadAvatarModelMock.mockReturnValue(deferred.promise);

    const { container, rerender, unmount } = render(
      <Harness state="idle" size={64} />,
    );

    expect(createLiveAvatarMock).toHaveBeenCalledTimes(1);
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(container.firstElementChild).toHaveAttribute("data-ready", "false");

    act(() => {
      intersect([{ isIntersecting: true }]);
    });
    expect(handle.setVisible).toHaveBeenCalledWith(true);

    rerender(<Harness state="thinking" size={64} />);
    expect(createLiveAvatarMock).toHaveBeenCalledTimes(1);
    expect(handle.setState).toHaveBeenLastCalledWith("thinking");

    await act(async () => {
      deferred.resolve(FAKE_MODEL);
      await deferred.promise;
    });

    expect(handle.setModel).toHaveBeenCalledWith(FAKE_MODEL);
    expect(container.firstElementChild).toHaveAttribute("data-ready", "true");

    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it("marks visible immediately when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const handle = createMockHandle();
    createLiveAvatarMock.mockReturnValue(handle);
    loadAvatarModelMock.mockResolvedValue(FAKE_MODEL);

    render(<Harness />);
    expect(handle.setVisible).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(handle.setModel).toHaveBeenCalledWith(FAKE_MODEL),
    );
  });

  it("destroys the handle immediately on WebGL context loss (onFail) and ignores cancelled loads", async () => {
    const firstHandle = createMockHandle();
    const secondHandle = createMockHandle();
    const firstLoad = Promise.withResolvers<AvatarModel>();
    const secondLoad = Promise.withResolvers<AvatarModel>();
    let capturedOnFail: (() => void) | undefined;

    createLiveAvatarMock
      .mockReturnValueOnce(firstHandle)
      .mockImplementationOnce((_canvas, opts) => {
        capturedOnFail = opts.onFail;
        return secondHandle;
      });
    loadAvatarModelMock
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const { container, rerender } = render(<Harness size={64} />);

    // Resize cancels the first load and destroys the first handle.
    rerender(<Harness size={128} />);
    expect(firstHandle.destroy).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstLoad.resolve(FAKE_MODEL);
      await firstLoad.promise;
    });
    expect(firstHandle.setModel).not.toHaveBeenCalled();

    // Context loss unmounts the canvas and destroys the live handle immediately.
    act(() => {
      capturedOnFail?.();
    });
    expect(container.firstElementChild).toHaveAttribute("data-failed", "true");
    expect(secondHandle.destroy).toHaveBeenCalledTimes(1);

    await act(async () => {
      secondLoad.reject(new Error("aborted"));
      await secondLoad.promise.catch(() => {});
    });
  });

  it("tracks pointermove gaze while enabled and clears look on disable or Activity hide/reveal", async () => {
    const firstHandle = createMockHandle();
    const secondHandle = createMockHandle();
    createLiveAvatarMock
      .mockReturnValueOnce(firstHandle)
      .mockReturnValueOnce(secondHandle);
    loadAvatarModelMock.mockResolvedValue(FAKE_MODEL);

    const { rerender } = render(
      <Activity mode="visible">
        <Harness gaze size={128} />
      </Activity>,
    );

    await waitFor(() =>
      expect(firstHandle.setModel).toHaveBeenCalledWith(FAKE_MODEL),
    );

    fireEvent.pointerMove(window, { clientX: 500, clientY: 300 });
    expect(firstHandle.setLook).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
    });

    // Activity hide destroys the avatar and stops pointer tracking.
    rerender(
      <Activity mode="hidden">
        <Harness gaze size={128} />
      </Activity>,
    );
    expect(firstHandle.destroy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    const callsWhileHidden = vi.mocked(firstHandle.setLook).mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    expect(firstHandle.setLook).toHaveBeenCalledTimes(callsWhileHidden);

    // Activity reveal creates a fresh handle and re-attaches gaze.
    rerender(
      <Activity mode="visible">
        <Harness gaze size={128} />
      </Activity>,
    );
    await waitFor(() =>
      expect(secondHandle.setModel).toHaveBeenCalledWith(FAKE_MODEL),
    );

    fireEvent.pointerMove(window, { clientX: 250, clientY: 150 });
    expect(secondHandle.setLook).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
    });

    // Disabling gaze resets look to null and removes the listener.
    rerender(
      <Activity mode="visible">
        <Harness gaze={false} size={128} />
      </Activity>,
    );
    expect(secondHandle.setLook).toHaveBeenLastCalledWith(null);
  });
});
