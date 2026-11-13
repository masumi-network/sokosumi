import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoicePlayer } from "./voice-player";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

const decodeAudioData = vi.fn();
let fileCount = 0;

beforeEach(() => {
  fileCount += 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      decodeAudioData = decodeAudioData;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  decodeAudioData.mockReset();
});

// Decoded waveforms are cached per URL, so each test plays its own file.
function url() {
  return `https://blob.example/voice-${fileCount}.m4a`;
}

describe("VoicePlayer", () => {
  it("draws the waveform from the decoded file", async () => {
    decodeAudioData.mockResolvedValue({
      duration: 4,
      getChannelData: () => new Float32Array(80).fill(0.5),
    });
    render(<VoicePlayer url={url()} fileName="Voice.m4a" />);

    await waitFor(() =>
      expect(screen.getAllByTestId("voice-player-bar")).toHaveLength(40),
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText("0:04")).toBeInTheDocument();
  });

  it("shows a plain track, no bars, when the file cannot be decoded", async () => {
    decodeAudioData.mockRejectedValue(new Error("unsupported"));
    render(<VoicePlayer url={url()} fileName="Voice.weba" />);

    await waitFor(() => expect(decodeAudioData).toHaveBeenCalled());
    expect(screen.queryByTestId("voice-player-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("cycles playback speed 1×, 1.5×, 2×", () => {
    decodeAudioData.mockRejectedValue(new Error("skip"));
    const { container } = render(
      <VoicePlayer url={url()} fileName="Voice.m4a" />,
    );
    const audio = container.querySelector("audio") as HTMLAudioElement;
    const speed = screen.getByRole("button", { name: "speed 1" });

    fireEvent.click(speed);
    expect(audio.playbackRate).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: "speed 1.5" }));
    expect(audio.playbackRate).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "speed 2" }));
    expect(audio.playbackRate).toBe(1);
  });

  it("shows the transcript and offers editing only with a save handler", () => {
    decodeAudioData.mockRejectedValue(new Error("skip"));
    const { rerender } = render(
      <VoicePlayer url={url()} fileName="Voice.m4a" transcript="Hi team" />,
    );
    expect(screen.getByTestId("voice-transcript")).toHaveTextContent(
      "Hi team",
    );
    expect(
      screen.queryByRole("button", { name: "editTranscript" }),
    ).not.toBeInTheDocument();

    const onSave = vi.fn();
    rerender(
      <VoicePlayer
        url={url()}
        fileName="Voice.m4a"
        transcript="Hi team"
        onSaveTranscript={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "editTranscript" }));
    const box = screen.getByRole("textbox", { name: "transcript" });
    expect(box).toHaveValue("Hi team");
    fireEvent.change(box, { target: { value: "Hi team, ship Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith("Hi team, ship Friday");
  });
});
