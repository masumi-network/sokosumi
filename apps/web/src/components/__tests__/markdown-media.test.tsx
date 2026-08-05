import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

describe("Markdown media", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a video element for markdown images that point at video files", () => {
    const { container } = render(
      <Markdown>
        {"![demo](https://blob.example.com/clip.mp4?download=1)"}
      </Markdown>,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://blob.example.com/clip.mp4");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an audio element for markdown images that point at audio files", () => {
    const { container } = render(
      <Markdown>{"![track](https://blob.example.com/track.mp3)"}</Markdown>,
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("src", "https://blob.example.com/track.mp3");
    expect(audio).toHaveAttribute("controls");
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps normal images as img", () => {
    const { container } = render(
      <Markdown>{"![photo](https://blob.example.com/photo.png)"}</Markdown>,
    );

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("strips autoplay from raw video and audio HTML and strips download query", () => {
    const { container } = render(
      <Markdown>
        {[
          '<video src="https://blob.example.com/clip.mp4?download=1" autoplay controls></video>',
          '<audio src="https://blob.example.com/track.mp3?download=1" autoplay controls></audio>',
        ].join("\n")}
      </Markdown>,
    );

    const video = container.querySelector("video");
    const audio = container.querySelector("audio");
    expect(video).not.toBeNull();
    expect(audio).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://blob.example.com/clip.mp4");
    expect(audio).toHaveAttribute("src", "https://blob.example.com/track.mp3");
    expect(video).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(audio).not.toHaveAttribute("autoplay");
  });
});
