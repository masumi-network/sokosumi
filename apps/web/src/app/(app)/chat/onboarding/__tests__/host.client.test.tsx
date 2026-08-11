import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureMock = vi.fn();
const replaceMock = vi.fn();
const toastErrorMock = vi.fn();
const notifyMock = vi.fn();
const stashMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (values?.goal) return values.goal;
    if (values?.intent) return `intent:${values.intent}`;
    if (values?.name) return `hi ${values.name}`;
    return key;
  },
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@/app/chat/actions", () => ({
  ensureCoworkerDirectRoomAction: (...args: unknown[]) => ensureMock(...args),
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: (...args: unknown[]) =>
    notifyMock(...args),
}));

vi.mock("@/app/chat/onboarding/composer-prefill", () => ({
  stashRoomComposerPrefill: (...args: unknown[]) => stashMock(...args),
}));

vi.mock("@/components/agents/coworker-gallery-card", () => ({
  CoworkerGalleryCard: ({ name }: { name: string }) => (
    <div data-testid="gallery-card">{name}</div>
  ),
}));

vi.mock("@/lib/utils/coworker-channels", () => ({
  getCoworkerMetadataChannels: () => [],
}));

import type { Coworker } from "@/app/chat/utils/types";
import { ChatOnboardingHost } from "../host.client";

const coworker: Coworker = {
  id: "elena-id",
  slug: "elena",
  name: "Elena",
  caption: "Strategy",
  description: "Helper",
  useCase: "",
  capabilities: ["chat"],
  canChat: true,
};

const coworkerAlex: Coworker = {
  id: "alex-id",
  slug: "alex",
  name: "Alex",
  caption: "Coding",
  description: "Coder",
  useCase: "",
  capabilities: ["chat"],
  canChat: true,
};

async function reachConfirm(coworkers: Coworker[] = [coworker]) {
  render(<ChatOnboardingHost coworkers={coworkers} userName="Francis" />);
  fireEvent.click(screen.getByLabelText(/intentChoices\.chat/i));
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  fireEvent.click(screen.getByRole("button", { name: "skip" }));
  await screen.findByText("confirmTitle");
}

describe("ChatOnboardingHost confirm", () => {
  beforeEach(() => {
    ensureMock.mockReset();
    replaceMock.mockReset();
    toastErrorMock.mockReset();
    notifyMock.mockReset();
    stashMock.mockReset();
  });

  it("on ensure failure toasts, stays on confirm, no stash or nav", async () => {
    ensureMock.mockResolvedValue({ ok: false, message: "ensure blew up" });
    await reachConfirm();

    fireEvent.click(screen.getByRole("button", { name: "confirmCta" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("ensure blew up");
    });
    expect(stashMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText("confirmTitle")).toBeTruthy();
  });

  it("on ensure success stashes prefill and navigates", async () => {
    ensureMock.mockResolvedValue({
      ok: true,
      data: { id: "room-99", kind: "direct" },
    });
    await reachConfirm();

    fireEvent.click(screen.getByRole("button", { name: "confirmCta" }));

    await waitFor(() => {
      expect(stashMock).toHaveBeenCalledWith("room-99", expect.any(String));
    });
    expect(notifyMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith("/chat/rooms/room-99");
  });

  it("rail switcher updates selected gallery card", async () => {
    await reachConfirm([coworker, coworkerAlex]);

    expect(screen.getByTestId("gallery-card").textContent).toBe("Elena");
    fireEvent.click(screen.getAllByRole("button", { name: /Alex/i })[0]!);
    expect(screen.getByTestId("gallery-card").textContent).toBe("Alex");
  });

  it("questionnaire shell uses the steps max-width", () => {
    const { container } = render(
      <ChatOnboardingHost coworkers={[coworker]} userName="Francis" />,
    );
    const shell = container.querySelector("[data-chat-onboarding-host] > div");
    expect(shell?.className).toContain("max-w-2xl");
  });

  it("goal step shows try-asking samples and or divider", async () => {
    render(<ChatOnboardingHost coworkers={[coworker]} userName="Francis" />);
    fireEvent.click(screen.getByLabelText(/intentChoices\.either/i));
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(screen.getByText("tryAsking.label")).toBeTruthy();
    expect(screen.getByText("tryAsking.orDivider")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "tryAsking.prompts.either.elena",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "tryAsking.prompts.either.elena",
      }),
    );
    expect(
      (screen.getByLabelText("goalLabel") as HTMLTextAreaElement).value,
    ).toBe("tryAsking.prompts.either.elena");
  });

  it("either skip recommends Elena on confirm", async () => {
    render(
      <ChatOnboardingHost
        coworkers={[coworkerAlex, coworker]}
        userName="Francis"
      />,
    );
    fireEvent.click(screen.getByLabelText(/intentChoices\.either/i));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await screen.findByText("confirmTitle");
    expect(screen.getByTestId("gallery-card").textContent).toBe("Elena");
  });
});
