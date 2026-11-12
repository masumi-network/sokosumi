// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AVATAR_REPLAY_MS, CusoAvatar } from "./cuso";
import { CusoClip } from "./cuso-clip";
import { Onboarding } from "./onboarding";

const media = { matches: false };
/** Every element `play()` was called on, in order. */
let played: HTMLMediaElement[];
/** Whether a clip is on screen as soon as it is watched. */
let onScreen: boolean;
let views: {
  seen: boolean;
  report: (entries: { isIntersecting: boolean }[]) => void;
}[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  media.matches = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return media.matches;
    },
    addEventListener() {},
    removeEventListener() {},
  }));
  played = [];
  onScreen = true;
  views = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      seen = false;
      constructor(
        readonly report: (entries: { isIntersecting: boolean }[]) => void,
      ) {
        views.push(this);
      }
      observe() {
        if (onScreen) this.report([{ isIntersecting: true }]);
      }
      disconnect() {
        this.seen = true;
      }
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return Promise.resolve();
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function end(video: HTMLVideoElement) {
  await act(async () => video.dispatchEvent(new Event("ended")));
}

function video(selector = "video"): HTMLVideoElement {
  const found = host.querySelector<HTMLVideoElement>(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
}

describe("CusoClip", () => {
  it("plays the MP4 over its still, which is the poster", async () => {
    await render(
      <CusoClip
        src="/cuso/celebration.jpg"
        alt="Cuso celebrating"
        width={320}
        height={320}
      />,
    );

    const clip = video();
    expect(clip.getAttribute("src")).toBe("/cuso/celebration.mp4");
    expect(clip.getAttribute("poster")).toBe("/cuso/celebration.jpg");
    expect(clip.muted).toBe(true);
    expect(clip.getAttribute("width")).toBe("320");
    expect(clip.getAttribute("height")).toBe("320");
    expect(clip.getAttribute("role")).toBe("img");
    expect(clip.getAttribute("aria-label")).toBe("Cuso celebrating");
    expect(played).toEqual([clip]);
  });

  it("hides a decorative clip from assistive tech", async () => {
    await render(<CusoAvatar pose="done" size={36} />);

    expect(video().getAttribute("aria-hidden")).toBe("true");
    expect(video().getAttribute("poster")).toBe("/cuso/done.png");
  });

  it("shows only the still under reduced motion", async () => {
    media.matches = true;
    await render(
      <CusoClip
        src="/cuso/hero.jpg"
        alt="Cuso walking"
        width={640}
        height={800}
      />,
    );

    expect(host.querySelector("video")).toBeNull();
    const still = host.querySelector("img");
    expect(still?.getAttribute("src")).toBe("/cuso/hero.jpg");
    expect(still?.getAttribute("alt")).toBe("Cuso walking");
    expect(played).toEqual([]);
  });

  it("says when it starts, and when autoplay is refused", async () => {
    const onStart = vi.fn();
    const onEnded = vi.fn();
    await render(
      <CusoClip
        src="/cuso/hero.jpg"
        alt=""
        width={640}
        height={800}
        onStart={onStart}
        onEnded={onEnded}
      />,
    );
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(0);

    await act(async () => root.render(null));
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new Error("NotAllowedError"),
    );
    await render(
      <CusoClip
        src="/cuso/hero.jpg"
        alt=""
        width={640}
        height={800}
        onStart={onStart}
        onEnded={onEnded}
      />,
    );
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("waits until it is on screen", async () => {
    onScreen = false;
    await render(
      <CusoClip src="/cuso/hero.jpg" alt="" width={640} height={800} />,
    );
    expect(played).toEqual([]);

    await act(async () => {
      for (const view of views) {
        if (!view.seen) view.report([{ isIntersecting: true }]);
      }
    });

    expect(played).toEqual([video()]);
  });

  it("plays a scene once", async () => {
    vi.useFakeTimers();
    await render(
      <CusoClip
        src="/cuso/reading-scene.jpg"
        alt=""
        width={168}
        height={168}
      />,
    );
    await end(video());
    await act(async () => vi.advanceTimersByTime(10 * AVATAR_REPLAY_MS));

    expect(played).toHaveLength(1);
  });
});

describe("CusoAvatar", () => {
  it("plays once, then again 30 seconds after each end", async () => {
    vi.useFakeTimers();
    await render(<CusoAvatar pose="thinking" size={36} />);
    const clip = video();
    expect(played).toHaveLength(1);

    clip.currentTime = 4;
    await end(clip);
    await act(async () => vi.advanceTimersByTime(AVATAR_REPLAY_MS - 1));
    expect(played).toHaveLength(1);

    await act(async () => vi.advanceTimersByTime(1));
    expect(played).toHaveLength(2);
    expect(clip.currentTime).toBe(0);

    await end(clip);
    await act(async () => vi.advanceTimersByTime(AVATAR_REPLAY_MS));
    expect(played).toHaveLength(3);
  });

  it("stops replaying once unmounted", async () => {
    vi.useFakeTimers();
    await render(<CusoAvatar pose="thinking" size={36} />);
    await end(video());
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTime(AVATAR_REPLAY_MS));

    expect(played).toHaveLength(1);
  });

  it("keeps the still when it does not animate", async () => {
    await render(<CusoAvatar pose="done" size={36} animate={false} />);

    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "/cuso/done.png",
    );
  });
});

describe("hire screen", () => {
  it("plays Cuso in the bar at once, beside the website question", async () => {
    await render(<Onboarding onboard={vi.fn()} />);
    const avatar = video(".brief-cuso .cuso-avatar video");
    expect(played).toEqual([avatar]);
  });
});
