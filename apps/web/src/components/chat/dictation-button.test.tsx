import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DICTATION_MAX_MS } from "@/hooks/effects/use-dictation-recorder";
import { DictationButton, formatVoiceElapsed } from "./dictation-button";

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

async function startRecording() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "dictate" }));
  });
}

describe("DictationButton", () => {
  it("hides the mic when the browser cannot record", () => {
    supported = [];
    render(<DictationButton onRecorded={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "dictate" })).toBeNull();
  });

  it("records WebM and hands it over on stop", async () => {
    const onRecorded = vi.fn();
    render(<DictationButton onRecorded={onRecorded} />);
    await startRecording();

    expect(lastRecorder?.options.mimeType).toBe("audio/webm");
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("timer").textContent).toContain("0:05");

    fireEvent.click(screen.getByRole("button", { name: "stopDictation" }));

    const file: File = onRecorded.mock.calls[0]?.[0];
    expect(file.type).toBe("audio/webm");
    expect(file.name).toBe("dictation.weba");
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "dictate" })).toBeTruthy();
  });

  it("prefers MP4 where the browser records it", async () => {
    supported = ["audio/mp4", "audio/webm"];
    const onRecorded = vi.fn();
    render(<DictationButton onRecorded={onRecorded} />);
    await startRecording();
    fireEvent.click(screen.getByRole("button", { name: "stopDictation" }));
    expect(onRecorded.mock.calls[0]?.[0].name).toMatch(/\.m4a$/);
  });

  it("discards the recording on cancel", async () => {
    const onRecorded = vi.fn();
    render(<DictationButton onRecorded={onRecorded} />);
    await startRecording();
    fireEvent.click(screen.getByRole("button", { name: "cancelDictation" }));
    expect(onRecorded).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("stops and hands it over at the time limit", async () => {
    const onRecorded = vi.fn();
    render(<DictationButton onRecorded={onRecorded} />);
    await startRecording();
    act(() => vi.advanceTimersByTime(DICTATION_MAX_MS + 250));
    expect(onRecorded).toHaveBeenCalledOnce();
  });

  it("explains a blocked microphone", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    render(<DictationButton onRecorded={vi.fn()} />);
    await startRecording();
    expect(toastErrorMock).toHaveBeenCalledWith("dictationBlocked");
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("opens the mic once when clicked twice during the permission prompt", async () => {
    let grant: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    render(<DictationButton onRecorded={vi.fn()} />);
    const mic = screen.getByRole("button", { name: "dictate" });
    fireEvent.click(mic);
    fireEvent.click(mic);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("releases the mic when the composer unmounts during the permission prompt", async () => {
    let grant: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const onRecorded = vi.fn();
    const onRecordingChange = vi.fn();
    const { unmount } = render(
      <DictationButton
        onRecorded={onRecorded}
        onRecordingChange={onRecordingChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "dictate" }));
    unmount();
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(lastRecorder).toBeNull();
    act(() => vi.advanceTimersByTime(DICTATION_MAX_MS + 250));
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onRecordingChange).not.toHaveBeenCalled();
  });

  it("releases the mic without handing it over when unmounted while recording", async () => {
    const onRecorded = vi.fn();
    const { unmount } = render(<DictationButton onRecorded={onRecorded} />);
    await startRecording();
    unmount();
    expect(stopTrack).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("moves focus to Stop on start and back to the mic on finish", async () => {
    const onRecordingChange = vi.fn();
    render(
      <DictationButton
        onRecorded={vi.fn()}
        onRecordingChange={onRecordingChange}
      />,
    );
    await startRecording();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "stopDictation" }),
    );
    expect(onRecordingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "stopDictation" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "dictate" }),
    );
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it("formats elapsed time as m:ss", () => {
    expect(formatVoiceElapsed(65_400)).toBe("1:05");
  });
});
