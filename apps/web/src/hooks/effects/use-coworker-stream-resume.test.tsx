import { render } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useCoworkerStreamResume } from "./use-coworker-stream-resume";

describe("useCoworkerStreamResume", () => {
  it("clears overlay when roomId is null and resumes in passive phase when roomId is set", () => {
    const events: string[] = [];
    const resumeStream = vi.fn(async () => {
      events.push("resume");
    });
    const clearOverlay = vi.fn(() => {
      events.push("clear");
    });

    function Probe({
      roomId,
      onResume,
      onClear,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
      onClear: () => void;
    }) {
      useCoworkerStreamResume(roomId, onResume, onClear);
      useLayoutEffect(() => {
        events.push(`layout:${roomId ?? "none"}`);
      }, [roomId]);
      return null;
    }

    const { rerender } = render(
      <Probe roomId={null} onResume={resumeStream} onClear={clearOverlay} />,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeStream).not.toHaveBeenCalled();
    expect(events).toEqual(["layout:none", "clear"]);

    rerender(
      <Probe roomId="room-a" onResume={resumeStream} onClear={clearOverlay} />,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["layout:none", "clear", "layout:room-a", "resume"]);

    // Unrelated rerender with the same roomId and callbacks does not re-resume.
    rerender(
      <Probe roomId="room-a" onResume={resumeStream} onClear={clearOverlay} />,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeStream).toHaveBeenCalledTimes(1);
  });

  it("clears overlay once when leaving a room and resumes again on room switch or Activity reveal", () => {
    const resumeA = vi.fn(async () => {});
    const resumeB = vi.fn(async () => {});
    const clearOverlay = vi.fn();

    function Probe({
      roomId,
      onResume,
      onClear,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
      onClear: () => void;
    }) {
      useCoworkerStreamResume(roomId, onResume, onClear);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe roomId="room-a" onResume={resumeA} onClear={clearOverlay} />
      </Activity>,
    );
    expect(resumeA).toHaveBeenCalledTimes(1);
    expect(clearOverlay).not.toHaveBeenCalled();

    // Leaving the room (roomId -> null) calls clearOverlay once and skips resume.
    rerender(
      <Activity mode="visible">
        <Probe roomId={null} onResume={resumeA} onClear={clearOverlay} />
      </Activity>,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeA).toHaveBeenCalledTimes(1);

    // Entering room B resumes with room B's callback without clearing again.
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} onClear={clearOverlay} />
      </Activity>,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeB).toHaveBeenCalledTimes(1);

    // Activity hide then reveal reconnects to the active stream.
    rerender(
      <Activity mode="hidden">
        <Probe roomId="room-b" onResume={resumeB} onClear={clearOverlay} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} onClear={clearOverlay} />
      </Activity>,
    );
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(resumeB).toHaveBeenCalledTimes(2);
  });
});
