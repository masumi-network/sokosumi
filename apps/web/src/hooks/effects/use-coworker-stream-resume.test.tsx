import { render } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useCoworkerStreamResume } from "./use-coworker-stream-resume";

describe("useCoworkerStreamResume", () => {
  it("skips resume when roomId is null and resumes in passive phase when roomId is set", () => {
    const events: string[] = [];
    const resumeStream = vi.fn(async () => {
      events.push("resume");
    });

    function Probe({
      roomId,
      onResume,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
    }) {
      useCoworkerStreamResume(roomId, onResume);
      useLayoutEffect(() => {
        events.push(`layout:${roomId ?? "none"}`);
      }, [roomId]);
      return null;
    }

    const { rerender } = render(
      <Probe roomId={null} onResume={resumeStream} />,
    );
    expect(resumeStream).not.toHaveBeenCalled();
    expect(events).toEqual(["layout:none"]);

    rerender(<Probe roomId="room-a" onResume={resumeStream} />);
    expect(resumeStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["layout:none", "layout:room-a", "resume"]);

    // Unrelated rerender with the same roomId and callback does not re-resume.
    rerender(<Probe roomId="room-a" onResume={resumeStream} />);
    expect(resumeStream).toHaveBeenCalledTimes(1);
  });

  it("resumes again when switching rooms, when resumeStream changes, or on Activity reveal", () => {
    const resumeA = vi.fn(async () => {});
    const resumeB = vi.fn(async () => {});

    function Probe({
      roomId,
      onResume,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
    }) {
      useCoworkerStreamResume(roomId, onResume);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe roomId="room-a" onResume={resumeA} />
      </Activity>,
    );
    expect(resumeA).toHaveBeenCalledTimes(1);

    // Leaving the room skips resume.
    rerender(
      <Activity mode="visible">
        <Probe roomId={null} onResume={resumeA} />
      </Activity>,
    );
    expect(resumeA).toHaveBeenCalledTimes(1);

    // Entering room B resumes with room B's callback.
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} />
      </Activity>,
    );
    expect(resumeB).toHaveBeenCalledTimes(1);

    // Activity hide then reveal reconnects to the active stream.
    rerender(
      <Activity mode="hidden">
        <Probe roomId="room-b" onResume={resumeB} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} />
      </Activity>,
    );
    expect(resumeB).toHaveBeenCalledTimes(2);
  });
});
