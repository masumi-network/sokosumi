import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AssistantConnectStep } from "./assistant-connect-step.client";

const startConnectMock = vi.fn();

vi.mock("@/lib/soko-bot/start-integration-connect", () => ({
  startSokoBotConnect: (...args: unknown[]) => startConnectMock(...args),
}));

const OFFERS = [
  { provider: "gmail", name: "Gmail", connected: false },
  { provider: "googlecalendar", name: "Google Calendar", connected: false },
  { provider: "outlook", name: "Outlook", connected: false },
];

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: () => <div data-testid="orb" />,
}));

function renderStep(offers = OFFERS, botImageUrl: string | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AssistantConnectStep
        botName="Atlas"
        botImageUrl={botImageUrl}
        botOrbSeed="orb:u1"
        offers={offers}
        chatUrl="/chat/rooms/room-1"
        returnTo="/setup/assistant/connect"
      />
    </NextIntlClientProvider>,
  );
}

describe("AssistantConnectStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startConnectMock.mockResolvedValue(null);
  });

  it("can be skipped straight into the chat", () => {
    renderStep();

    expect(
      screen.getByRole("heading", {
        name: "Give Atlas your inbox and calendar",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip" })).toHaveAttribute(
      "href",
      "/chat/rooms/room-1",
    );
  });

  it("keeps the picture picked on the step before", () => {
    const { container } = renderStep(OFFERS, "https://blob.test/owl-1.png");

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://blob.test/owl-1.png",
    );
    expect(screen.queryByTestId("orb")).toBeNull();
  });

  it("shows the orb when the bot was created without a picture", () => {
    renderStep();

    expect(screen.getByTestId("orb")).toBeTruthy();
  });

  it("starts at its heading, since the step before it is gone", () => {
    renderStep();

    expect(
      screen.getByRole("heading", {
        name: "Give Atlas your inbox and calendar",
      }),
    ).toHaveFocus();
  });

  it("connects a provider and comes back to this step", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "Connect Gmail" }));

    expect(startConnectMock).toHaveBeenCalledWith("gmail", {
      returnTo: "/setup/assistant/connect",
    });
  });

  it("shows what is connected and continues to the chat", () => {
    renderStep([{ ...OFFERS[0], connected: true }, OFFERS[1], OFFERS[2]]);

    expect(
      screen.getByRole("button", { name: "Gmail connected" }),
    ).toBeDisabled();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/chat/rooms/room-1",
    );
  });
});
