import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { AssistantAvatar, AssistantImageContext } from "./assistant-avatar";

describe("AssistantAvatar", () => {
  it("shows the bot's one picture, uncropped", () => {
    render(
      <AssistantImageContext.Provider value="https://blob/avatar.webp">
        <AssistantAvatar />
      </AssistantImageContext.Provider>,
    );
    const face = screen.getByRole("img", { name: "avatarAlt" });
    expect(face).toHaveAttribute("src", "https://blob/avatar.webp");
    expect(face.className).toContain("object-cover");
    expect(document.querySelector("video")).toBeNull();
  });

  it("draws the orb for a bot with no picture", () => {
    render(
      <AssistantImageContext.Provider value={null}>
        <AssistantAvatar />
      </AssistantImageContext.Provider>,
    );
    expect(
      screen.queryByRole("img", { name: "avatarAlt" })?.getAttribute("src") ??
        null,
    ).toBeNull();
  });
});
