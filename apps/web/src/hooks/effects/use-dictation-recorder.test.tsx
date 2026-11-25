import { act, render } from "@testing-library/react";
import {
  Activity,
  StrictMode,
  startTransition,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
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
let deferStop = false;

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
    if (!deferStop) {
      this.flushStop();
    }
  }
  flushStop() {
    this.ondataavailable?.({ data: new Blob(["voice"]) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  supported = ["audio/webm"];
  lastRecorder = null;
  deferStop = false;
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

function nextMacrotask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

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
    expect(onRecordingChange).toHaveBeenCalledTimes(2);
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it("reports onRecordingChange(false) once and resets state across Activity hide and reveal", async () => {
    const onRecorded = vi.fn();
    const initialOnRecordingChange = vi.fn();
    const latestOnRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe({
      onRecordingChange,
    }: {
      onRecordingChange: (recording: boolean) => void;
    }) {
      api = useDictationRecorder({ onRecorded, onRecordingChange });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe onRecordingChange={initialOnRecordingChange} />
        </Activity>
      </StrictMode>,
    );

    await act(async () => {
      await api.start();
    });
    expect(api.elapsedMs).toBe(0);
    expect(initialOnRecordingChange).toHaveBeenCalledTimes(1);
    expect(initialOnRecordingChange).toHaveBeenLastCalledWith(true);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe onRecordingChange={latestOnRecordingChange} />
        </Activity>
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe onRecordingChange={latestOnRecordingChange} />
        </Activity>
      </StrictMode>,
    );

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(initialOnRecordingChange).toHaveBeenCalledTimes(1);
    expect(latestOnRecordingChange).toHaveBeenCalledTimes(1);
    expect(latestOnRecordingChange).toHaveBeenLastCalledWith(false);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe onRecordingChange={latestOnRecordingChange} />
        </Activity>
      </StrictMode>,
    );

    expect(api.elapsedMs).toBeNull();
    expect(latestOnRecordingChange).toHaveBeenCalledTimes(1);

    // Starting again after reveal, finishing, then hiding still reports false only once.
    latestOnRecordingChange.mockClear();
    await act(async () => {
      await api.start();
    });
    act(() => {
      api.finish(false);
    });
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe onRecordingChange={latestOnRecordingChange} />
        </Activity>
      </StrictMode>,
    );
    expect(latestOnRecordingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("clears starting when hidden under Activity during the permission prompt", async () => {
    let grant: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );

    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded: vi.fn(), onRecordingChange });
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    act(() => {
      void api.start();
    });
    expect(api.starting).toBe(true);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );

    await act(async () => {
      grant({ getTracks: () => [{ stop: stopTrack }] });
    });

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBeNull();
    expect(onRecordingChange).not.toHaveBeenCalled();
  });

  it("drops a pending transcription when hidden after finish(true) before onstop fires, while normal stop delivers once", async () => {
    deferStop = true;
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded, onRecordingChange });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );

    // Case A: Stop, hide before onstop, onstop fires while hidden.
    await act(async () => {
      await api.start();
    });
    const firstRecorder = lastRecorder;
    act(() => {
      api.finish(true);
    });
    expect(onRecordingChange.mock.calls).toEqual([[true], [false]]);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );

    act(() => {
      firstRecorder?.flushStop();
    });
    expect(onRecorded).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(api.elapsedMs).toBeNull();
    expect(api.starting).toBe(false);
    expect(onRecordingChange.mock.calls).toEqual([[true], [false]]);

    // Case B: Stop, hide, reveal, then stale onstop fires after reveal.
    await act(async () => {
      await api.start();
    });
    const secondRecorder = lastRecorder;
    act(() => {
      api.finish(true);
    });
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      secondRecorder?.flushStop();
    });
    expect(onRecorded).not.toHaveBeenCalled();

    // Case C: Normal Stop while visible delivers exactly one transcription.
    await act(async () => {
      await api.start();
    });
    const thirdRecorder = lastRecorder;
    act(() => {
      api.finish(true);
    });
    act(() => {
      thirdRecorder?.flushStop();
    });
    expect(onRecorded).toHaveBeenCalledOnce();
  });

  it("ignores a permission grant or denial after Activity hide and reveal until started again", async () => {
    let grantFirst: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grantFirst = resolve;
        }),
    );

    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;

    function Probe() {
      api = useDictationRecorder({ onRecorded, onRecordingChange });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );

    act(() => {
      void api.start();
    });
    expect(api.starting).toBe(true);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );

    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBeNull();

    await act(async () => {
      grantFirst({ getTracks: () => [{ stop: stopTrack }] });
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(lastRecorder).toBeNull();
    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBeNull();
    expect(onRecordingChange).not.toHaveBeenCalled();

    // A stale denial after hide+reveal neither toasts nor clobbers a new start.
    let denySecond: (error: unknown) => void = () => undefined;
    let grantThird: (stream: unknown) => void = () => undefined;
    getUserMedia
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            denySecond = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            grantThird = resolve;
          }),
      );

    act(() => {
      void api.start();
    });
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      void api.start();
    });
    expect(api.starting).toBe(true);

    await act(async () => {
      denySecond(new Error("NotAllowedError"));
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(api.starting).toBe(true);

    const stopThirdTrack = vi.fn();
    await act(async () => {
      grantThird({ getTracks: () => [{ stop: stopThirdTrack }] });
    });
    expect(api.starting).toBe(false);
    expect(api.elapsedMs).toBe(0);
    expect(onRecordingChange).toHaveBeenCalledWith(true);
  });

  it("starts recording when start is called right after Activity reveal commit before passive effects run", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;
    let setMode!: (mode: "visible" | "hidden") => void;
    let resolveRevealCommit: () => void = () => undefined;
    const revealCommitted = new Promise<void>((resolve) => {
      resolveRevealCommit = resolve;
    });

    function Probe() {
      api = useDictationRecorder({ onRecorded: vi.fn(), onRecordingChange });
      return null;
    }

    function CommitSignal() {
      useLayoutEffect(() => {
        resolveRevealCommit();
      }, []);
      return null;
    }

    function Host() {
      const [mode, updateMode] = useState<"visible" | "hidden">("hidden");
      setMode = updateMode;
      return (
        <Activity mode={mode}>
          <Probe />
          <CommitSignal />
        </Activity>
      );
    }

    try {
      await act(async () => {
        root.render(<Host />);
      });

      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      startTransition(() => {
        setMode("visible");
      });
      await revealCommitted;

      // Passive effects are still queued on the next macrotask; start runs in the commit-to-passive window.
      await api.start();
      await nextMacrotask();
      await nextMacrotask();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(api.elapsedMs).toBe(0);
      expect(onRecordingChange).toHaveBeenLastCalledWith(true);
    } finally {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("drops a recorder stop event arriving between Activity hide commit and passive cleanup", async () => {
    deferStop = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onRecorded = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;
    let setMode!: (mode: "visible" | "hidden") => void;
    let resolveHideCommit: () => void = () => undefined;
    const hideCommitted = new Promise<void>((resolve) => {
      resolveHideCommit = resolve;
    });

    function Probe() {
      api = useDictationRecorder({ onRecorded });
      return null;
    }

    function CommitSignal() {
      useLayoutEffect(() => {
        return () => {
          resolveHideCommit();
        };
      }, []);
      return null;
    }

    function Host() {
      const [mode, updateMode] = useState<"visible" | "hidden">("visible");
      setMode = updateMode;
      return (
        <Activity mode={mode}>
          <Probe />
          <CommitSignal />
        </Activity>
      );
    }

    try {
      await act(async () => {
        root.render(<Host />);
      });

      await act(async () => {
        await api.start();
      });
      const activeRecorder = lastRecorder;
      act(() => {
        api.finish(true);
      });

      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      startTransition(() => {
        setMode("hidden");
      });
      await hideCommitted;

      // Passive cleanup has not run yet; a queued stop event must still be dropped.
      activeRecorder?.flushStop();
      await nextMacrotask();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

      expect(onRecorded).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("does not start recording when a permission grant arrives between Activity hide commit and passive cleanup", async () => {
    let grant: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onRecordingChange = vi.fn();
    let api!: ReturnType<typeof useDictationRecorder>;
    let setMode!: (mode: "visible" | "hidden") => void;
    let resolveHideCommit: () => void = () => undefined;
    const hideCommitted = new Promise<void>((resolve) => {
      resolveHideCommit = resolve;
    });

    function Probe() {
      api = useDictationRecorder({ onRecorded: vi.fn(), onRecordingChange });
      return null;
    }

    function CommitSignal() {
      useLayoutEffect(() => {
        return () => {
          resolveHideCommit();
        };
      }, []);
      return null;
    }

    function Host() {
      const [mode, updateMode] = useState<"visible" | "hidden">("visible");
      setMode = updateMode;
      return (
        <Activity mode={mode}>
          <Probe />
          <CommitSignal />
        </Activity>
      );
    }

    try {
      await act(async () => {
        root.render(<Host />);
      });

      act(() => {
        void api.start();
      });
      expect(api.starting).toBe(true);

      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      startTransition(() => {
        setMode("hidden");
      });
      await hideCommitted;

      // Resolve getUserMedia in the microtask turn before passive cleanup runs.
      grant({ getTracks: () => [{ stop: stopTrack }] });
      await Promise.resolve();

      expect(stopTrack).toHaveBeenCalledOnce();
      expect(lastRecorder).toBeNull();
      expect(onRecordingChange).not.toHaveBeenCalled();

      await nextMacrotask();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

      await act(async () => {
        setMode("visible");
      });
      expect(api.starting).toBe(false);
      expect(api.elapsedMs).toBeNull();
    } finally {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
