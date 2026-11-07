import type { SokoBotAvatar } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AvatarPicker } from "./avatar-picker.client";

const topUpMock = vi.fn();

vi.mock("@/lib/actions/soko-bot/action", () => ({
  topUpSokoBotAvatarsAction: (...args: unknown[]) => topUpMock(...args),
}));

function avatars(...subjects: string[]): SokoBotAvatar[] {
  return subjects.map(
    (subject) =>
      ({
        id: subject,
        subject,
        imageUrl: `https://example.com/${subject}.webp`,
      }) as SokoBotAvatar,
  );
}

function Harness({ currentImageUrl }: { currentImageUrl?: string }) {
  const [picked, setPicked] = useState<SokoBotAvatar | null>(null);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <AvatarPicker
        value={picked?.id ?? null}
        onChange={setPicked}
        currentImageUrl={currentImageUrl}
      />
      <span data-testid="picked">{picked?.id ?? "current"}</span>
    </NextIntlClientProvider>
  );
}

function pressed(name: string) {
  return screen.getByRole("button", { name }).getAttribute("aria-pressed");
}

describe("AvatarPicker", () => {
  it("keeps the pick on screen after showing others", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("frog", "owl") })
      .mockResolvedValueOnce({ ok: true, value: avatars("otter", "hedgehog") });
    render(<Harness />);

    await waitFor(() => expect(pressed("frog")).toBe("true"));

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() => expect(pressed("otter")).toBe("true"));
    expect(screen.getByTestId("picked").textContent).toBe("otter");
  });

  it("falls back to the bot's current picture when the pick leaves", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("frog", "owl") })
      .mockResolvedValueOnce({ ok: true, value: avatars("otter", "hedgehog") });
    render(<Harness currentImageUrl="https://example.com/mine.webp" />);

    const owl = await screen.findByRole("button", { name: "owl" });
    expect(pressed("Current picture")).toBe("true");
    await user.click(owl);
    expect(pressed("owl")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() => expect(pressed("Current picture")).toBe("true"));
    expect(screen.queryByRole("button", { name: "owl" })).toBeNull();
  });
});
