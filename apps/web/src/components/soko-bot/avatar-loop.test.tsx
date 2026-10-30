import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reduceMotion = vi.hoisted(() => ({ current: false }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => reduceMotion.current,
}));

import { AvatarLoop } from "./avatar-loop";

const play = vi.fn(() => Promise.resolve());

function video(container: HTMLElement) {
  return container.querySelector("video") as HTMLVideoElement | null;
}

describe("AvatarLoop", () => {
  beforeEach(() => {
    reduceMotion.current = false;
    play.mockClear();
    // No media playback in the test DOM.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
  });

  it("plays a silent, inline, controls-free clip over the still as its poster", () => {
    const { container } = render(
      <AvatarLoop
        poster="https://blob/still.png"
        src="https://blob/loop.mp4"
        playing
        alt="Ops, Working"
      />,
    );
    const clip = video(container);

    expect(clip).toHaveAttribute("src", "https://blob/loop.mp4");
    expect(clip).toHaveAttribute("poster", "https://blob/still.png");
    expect(clip).toHaveAttribute("aria-hidden", "true");
    expect(clip).toHaveAttribute("preload", "auto");
    expect(clip).toHaveAttribute("playsinline");
    expect(clip).toHaveAttribute("disablepictureinpicture");
    expect(clip).not.toHaveAttribute("controls");
    expect(clip?.muted).toBe(true);
    expect(play).toHaveBeenCalled();
  });

  it("keeps the name on a screen-reader-only still while the clip plays", () => {
    render(
      <AvatarLoop
        poster="https://blob/still.png"
        src="https://blob/loop.mp4"
        playing
        alt="Ops, Working"
      />,
    );
    expect(screen.getByRole("img", { name: "Ops, Working" })).toHaveAttribute(
      "src",
      "https://blob/still.png",
    );
  });

  it("repeats only when asked to", () => {
    const { container, rerender } = render(
      <AvatarLoop poster="p.png" src="l.mp4" playing />,
    );
    expect(video(container)?.loop).toBe(false);

    rerender(<AvatarLoop poster="p.png" src="l.mp4" playing loop />);
    expect(video(container)?.loop).toBe(true);
  });

  it("reports the end of the clip, and a failure to play it", () => {
    const onEnded = vi.fn();
    const { container } = render(
      <AvatarLoop poster="p.png" src="l.mp4" playing onEnded={onEnded} />,
    );

    fireEvent.ended(video(container) as HTMLVideoElement);
    fireEvent.error(video(container) as HTMLVideoElement);

    expect(onEnded).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["is not playing", { playing: false, src: "l.mp4" }],
    ["has no loop yet", { playing: true, src: null }],
  ])("shows only the still when it %s", (_name, props) => {
    const { container } = render(
      <AvatarLoop poster="p.png" alt="Ops" {...props} />,
    );
    expect(video(container)).toBeNull();
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "p.png",
    );
  });

  it("shows only the still under reduced motion", () => {
    reduceMotion.current = true;
    const { container } = render(
      <AvatarLoop poster="p.png" src="l.mp4" playing alt="Ops" />,
    );
    expect(video(container)).toBeNull();
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "p.png",
    );
  });
});
