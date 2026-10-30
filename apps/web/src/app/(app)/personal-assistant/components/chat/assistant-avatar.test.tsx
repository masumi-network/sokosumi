import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { AssistantAvatar, AssistantImageContext } from "./assistant-avatar";

describe("AssistantAvatar", () => {
  it("names the bot and its state, and crops a crafted scene to the face", () => {
    render(
      <AssistantImageContext.Provider
        value={{
          url: "https://blob/idle.png",
          crafted: true,
          alt: "Ops, Done",
          stateStill: "https://blob/idle.png",
          stateLoop: null,
        }}
      >
        <AssistantAvatar />
      </AssistantImageContext.Provider>,
    );
    const face = screen.getByRole("img", { name: "Ops, Done" });
    expect(face).toHaveAttribute("src", "https://blob/idle.png");
    expect(face.className).toContain("size-[240%]");
  });

  it("leaves a mascot uncropped", () => {
    render(
      <AssistantImageContext.Provider
        value={{
          url: "https://blob/m.png",
          crafted: false,
          alt: "Ops, Idle",
          stateStill: "https://blob/m.png",
          stateLoop: null,
        }}
      >
        <AssistantAvatar />
      </AssistantImageContext.Provider>,
    );
    expect(
      screen.getByRole("img", { name: "Ops, Idle" }).className,
    ).not.toContain("size-[240%]");
  });
});
