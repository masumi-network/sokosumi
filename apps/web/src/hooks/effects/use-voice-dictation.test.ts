import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DICTATION_MAX_MS, useVoiceDictation } from "./use-voice-dictation";

const stopTrack = vi.fn();
let supported: string[] = [];
let lastRecorder: FakeRecorder | null = null;

class FakeRecorder {
  static isTypeSupported(type: string) {
    return supported.includes(type);
  }
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    _stream: MediaStream,
    readonly options: { mimeType: string },
  ) {
    lastRecorder = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"]) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();

describe("useVoiceDictation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    supported = ["audio/webm"];
    lastRecorder = null;
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("records audio, advances elapsed time, and delivers a File on finish(true)", async () => {
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    const { result } = renderHook(() =>
      useVoiceDictation({ onRecorded, onRecordingChange }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.elapsedMs).toBe(0);
    expect(onRecordingChange).toHaveBeenCalledExactlyOnceWith(true);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1_000);

    act(() => {
      result.current.finish(true);
    });

    expect(result.current.elapsedMs).toBeNull();
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
    expect(onRecorded).toHaveBeenCalledOnce();
    expect(onRecorded.mock.calls[0]?.[0].name).toBe("dictation.weba");
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("stops and delivers audio automatically at DICTATION_MAX_MS", async () => {
    const onRecorded = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ onRecorded }));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      vi.advanceTimersByTime(DICTATION_MAX_MS + 250);
    });

    expect(onRecorded).toHaveBeenCalledOnce();
    expect(result.current.elapsedMs).toBeNull();
  });

  it("releases the stream without starting a recorder if unmounted during getUserMedia", async () => {
    let resolveStream: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
    );
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    const onBlocked = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVoiceDictation({ onRecorded, onRecordingChange, onBlocked }),
    );

    act(() => {
      void result.current.start();
    });
    expect(result.current.starting).toBe(true);

    unmount();

    await act(async () => {
      resolveStream({ getTracks: () => [{ stop: stopTrack }] });
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(lastRecorder).toBeNull();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onRecordingChange).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("stops tracks and discards audio when unmounted while recording", async () => {
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVoiceDictation({ onRecorded, onRecordingChange }),
    );

    await act(async () => {
      await result.current.start();
    });
    onRecordingChange.mockClear();

    unmount();

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onRecordingChange).not.toHaveBeenCalled();
  });

  it("reports onError and cleans up when MediaRecorder errors", async () => {
    const onError = vi.fn();
    const onRecordingChange = vi.fn();
    const { result } = renderHook(() =>
      useVoiceDictation({ onRecorded: vi.fn(), onRecordingChange, onError }),
    );

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      lastRecorder?.onerror?.();
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(result.current.elapsedMs).toBeNull();
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });
});
