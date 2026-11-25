import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DICTATION_MAX_MS,
  useDictationRecorder,
} from "./use-dictation-recorder";

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

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

describe("useDictationRecorder", () => {
  it("records audio, tracks elapsedMs, delivers a File on finish(true), and works under StrictMode", async () => {
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded, onRecordingChange });
      return null;
    }

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBeNull();

    await act(async () => {
      await api.start();
    });

    expect(api.elapsedMs).toBe(0);
    expect(onRecordingChange).toHaveBeenLastCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(api.elapsedMs).toBe(1_000);

    act(() => {
      api.finish(true);
    });

    const file: File = onRecorded.mock.calls[0]?.[0];
    expect(file.type).toBe("audio/webm");
    expect(file.name).toBe("dictation.weba");
    expect(stopTrack).toHaveBeenCalled();
    expect(api.elapsedMs).toBeNull();
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it("auto-finishes at DICTATION_MAX_MS and discards on finish(false)", async () => {
    const onRecorded = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded });
      return null;
    }

    render(<Probe />);

    await act(async () => {
      await api.start();
    });
    act(() => {
      api.finish(false);
    });
    expect(onRecorded).not.toHaveBeenCalled();

    await act(async () => {
      await api.start();
    });
    act(() => {
      vi.advanceTimersByTime(DICTATION_MAX_MS + 250);
    });
    expect(onRecorded).toHaveBeenCalledOnce();
    expect(api.elapsedMs).toBeNull();
  });

  it("toasts on getUserMedia failure and recorder.onerror", async () => {
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded: vi.fn() });
      return null;
    }

    render(<Probe />);

    getUserMedia.mockRejectedValueOnce(new Error("NotAllowedError"));
    await act(async () => {
      await api.start();
    });
    expect(toastErrorMock).toHaveBeenCalledWith("dictationBlocked");
    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBeNull();

    toastErrorMock.mockClear();
    await act(async () => {
      await api.start();
    });
    act(() => {
      lastRecorder?.onerror?.();
    });
    expect(toastErrorMock).toHaveBeenCalledWith("voiceFailed");
    expect(api.elapsedMs).toBeNull();
  });

  it("stops the stream on unmount during permission prompt or while recording", async () => {
    let grant: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );

    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded, onRecordingChange });
      return null;
    }

    const first = render(<Probe />);
    act(() => {
      void api.start();
    });
    expect(api.starting).toBe(true);
    first.unmount();

    await act(async () => {
      grant({ getTracks: () => [{ stop: stopTrack }] });
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(lastRecorder).toBeNull();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onRecordingChange).not.toHaveBeenCalled();

    stopTrack.mockClear();
    const second = render(<Probe />);
    await act(async () => {
      await api.start();
    });
    expect(onRecordingChange).toHaveBeenCalledWith(true);
    second.unmount();

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onRecorded).not.toHaveBeenCalled();
    // Verbatim move: unmount cleanup returns before onRecordingChange(false) (ticket J).
    expect(onRecordingChange).toHaveBeenCalledTimes(1);
  });
});
