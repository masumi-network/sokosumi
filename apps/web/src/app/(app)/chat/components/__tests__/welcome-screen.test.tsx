import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: { name?: string }) => {
      if (key === "welcomeScreen.greetingWithName") {
        return `Welcome ${values?.name}!`;
      }
      if (key === "welcomeScreen.greeting") {
        return "Welcome!";
      }
      if (key === "welcomeScreen.question") {
        return "How can we help you today?";
      }
      if (key === "welcomeScreen.suggestionsLabel") {
        return "Try asking";
      }
      if (key.startsWith("welcomeScreen.prompts.")) {
        return null;
      }
      return key;
    };
    t.has = (key: string) => key.startsWith("welcomeScreen.prompts.") === false;
    return t;
  },
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => mockIsApple,
}));

vi.mock("@/components/chat/multimodal-input", () => ({
  MultimodalInput: () => <div data-testid="multimodal-input" />,
}));

import WelcomeScreen from "../welcome-screen";

const baseProps = {
  isTransitioning: false,
  input: "",
  setInput: vi.fn(),
  messages: [],
  setMessages: vi.fn(),
  sendMessage: vi.fn(),
  status: "ready" as const,
  stop: vi.fn(),
  onSendMessage: vi.fn(),
};

describe("WelcomeScreen", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
  });

  it("lifts composer above the mobile tab bar on home", () => {
    render(<WelcomeScreen {...baseProps} userName="Francis" />);

    const dock = document.querySelector("[data-welcome-composer-dock]");
    expect(dock?.className).toContain(
      "bottom-[calc(4rem+env(safe-area-inset-bottom))]",
    );
  });

  it("pins composer to the bottom on welcome compose without tab bar", () => {
    mockSearchParams = new URLSearchParams("welcome=1");
    render(<WelcomeScreen {...baseProps} userName="Francis" />);

    const dock = document.querySelector("[data-welcome-composer-dock]");
    expect(dock?.className).toContain("bottom-0");
    expect(dock?.className).not.toContain(
      "bottom-[calc(4rem+env(safe-area-inset-bottom))]",
    );
  });

  it("matches room composer side padding", () => {
    mockSearchParams = new URLSearchParams("welcome=1");
    render(<WelcomeScreen {...baseProps} userName="Francis" />);

    const dock = document.querySelector("[data-welcome-composer-dock]");
    expect(dock?.className).toContain("px-3");
    expect(dock?.className).toContain("md:px-5");
    expect(dock?.className).not.toContain("px-4");
    expect(dock?.className).not.toContain("md:px-8");
  });

  it("pads the welcome message block on the sides", () => {
    render(<WelcomeScreen {...baseProps} userName="Francis" />);

    const greeting = screen.getByRole("heading", { name: /Welcome Francis/i });
    const padded = greeting.closest(".px-4");
    expect(padded).toBeTruthy();
  });
});
