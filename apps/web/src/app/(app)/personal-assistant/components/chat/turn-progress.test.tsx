import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

const { reduceMotion } = vi.hoisted(() => ({
  reduceMotion: { current: false },
}));

vi.mock("motion/react", () => ({
  useReducedMotion: () => reduceMotion.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.raw = () => ({ one: "Thinking" });
    t.has = () => false;
    return t;
  },
}));

vi.mock("./thinking-orb", () => ({
  ThinkingOrb: () => <span data-testid="thinking-orb" />,
}));

import { AssistantImageContext } from "./assistant-avatar";
import { TurnProgress } from "./turn-progress";

const IMAGE = {
  url: "https://blob/idle.png",
  crafted: true,
  alt: "Ops, Working",
  stateStill: "https://blob/working.png",
  stateLoop: "https://blob/working-480.mp4",
};

function renderProgress(
  image: ComponentProps<typeof AssistantImageContext.Provider>["value"],
) {
  return render(
    <AssistantImageContext.Provider value={image}>
      <TurnProgress
        chips={[]}
        startedAt={null}
        orbState="solving"
        cancelRequested={false}
      />
    </AssistantImageContext.Provider>,
  );
}

describe("TurnProgress face", () => {
  it("loops the bot's own state while the turn runs", () => {
    reduceMotion.current = false;
    renderProgress(IMAGE);

    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", IMAGE.stateLoop);
    expect(video).toHaveAttribute("loop");
    expect(screen.queryByTestId("thinking-orb")).toBeNull();
  });

  it("rests on the state's still until its loop exists", () => {
    reduceMotion.current = false;
    renderProgress({ ...IMAGE, stateLoop: null });

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("img", { name: IMAGE.alt })).toHaveAttribute(
      "src",
      IMAGE.stateStill,
    );
  });

  it("is the still under reduced motion", () => {
    reduceMotion.current = true;
    renderProgress(IMAGE);

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("img", { name: IMAGE.alt })).toBeInTheDocument();
  });

  it("keeps the orb for a mascot and for a bot with no picture", () => {
    reduceMotion.current = false;
    const { unmount } = renderProgress({ ...IMAGE, crafted: false });
    expect(screen.getByTestId("thinking-orb")).toBeInTheDocument();
    unmount();

    renderProgress(null);
    expect(screen.getByTestId("thinking-orb")).toBeInTheDocument();
  });
});
