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
    const stop = vi.fn(async () => {
      events.push("stop");
    });

    function Probe({
      roomId,
      onResume,
      onStop,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
      onStop: () => Promise<void>;
    }) {
      useCoworkerStreamResume(roomId, onResume, onStop);
      useLayoutEffect(() => {
        events.push(`layout:${roomId ?? "none"}`);
      }, [roomId]);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe roomId={null} onResume={resumeStream} onStop={stop} />,
    );
    expect(resumeStream).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(events).toEqual(["layout:none"]);

    rerender(<Probe roomId="room-a" onResume={resumeStream} onStop={stop} />);
    expect(resumeStream).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(events).toEqual(["layout:none", "layout:room-a", "resume"]);

    // Unrelated rerender with the same roomId and callbacks does not re-resume or stop.
    rerender(<Probe roomId="room-a" onResume={resumeStream} onStop={stop} />);
    expect(resumeStream).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops on room switch, leaving a room, and Activity hide, and resumes again on reveal", () => {
    const resumeA = vi.fn(async () => {});
    const stopA = vi.fn(async () => {});
    const resumeB = vi.fn(async () => {});
    const stopB = vi.fn(async () => {});

    function Probe({
      roomId,
      onResume,
      onStop,
    }: {
      roomId: string | null;
      onResume: () => Promise<void>;
      onStop: () => Promise<void>;
    }) {
      useCoworkerStreamResume(roomId, onResume, onStop);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe roomId="room-a" onResume={resumeA} onStop={stopA} />
      </Activity>,
    );
    expect(resumeA).toHaveBeenCalledTimes(1);
    expect(stopA).not.toHaveBeenCalled();

    // Switching rooms stops room A's Chat and resumes room B's Chat.
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} onStop={stopB} />
      </Activity>,
    );
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(resumeB).toHaveBeenCalledTimes(1);
    expect(stopB).not.toHaveBeenCalled();

    // Activity hide stops the active stream; reveal reconnects.
    rerender(
      <Activity mode="hidden">
        <Probe roomId="room-b" onResume={resumeB} onStop={stopB} />
      </Activity>,
    );
    expect(stopB).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <Probe roomId="room-b" onResume={resumeB} onStop={stopB} />
      </Activity>,
    );
    expect(resumeB).toHaveBeenCalledTimes(2);

    // Leaving the room (roomId -> null) stops once and does not resume.
    rerender(
      <Activity mode="visible">
        <Probe roomId={null} onResume={resumeB} onStop={stopB} />
      </Activity>,
    );
    expect(stopB).toHaveBeenCalledTimes(2);
    expect(resumeB).toHaveBeenCalledTimes(2);

    unmount();
    expect(stopB).toHaveBeenCalledTimes(2);
  });
});
