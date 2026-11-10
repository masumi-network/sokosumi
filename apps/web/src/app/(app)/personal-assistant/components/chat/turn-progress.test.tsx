import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

function renderProgress(image: string | null) {
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
  it("shows the thinking orb while a turn runs, whatever the bot's picture", () => {
    const { unmount } = renderProgress("https://blob/avatar.webp");
    expect(screen.getByTestId("thinking-orb")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
    unmount();

    renderProgress(null);
    expect(screen.getByTestId("thinking-orb")).toBeInTheDocument();
  });
});
