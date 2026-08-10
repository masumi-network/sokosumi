import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmojiPicker } from "../emoji-picker";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      searchPlaceholder: "Search all emoji",
      frequentlyUsed: "Frequently used",
      noResults: "No emoji found",
      "categories.smileysEmotion": "Smileys & Emotion",
      "categories.peopleBody": "People & Body",
      "categories.animalsNature": "Animals & Nature",
      "categories.foodDrink": "Food & Drink",
      "categories.travelPlaces": "Travel & Places",
      "categories.activities": "Activities",
      "categories.objects": "Objects",
      "categories.symbols": "Symbols",
      "categories.flags": "Flags",
    };
    return labels[key] ?? key;
  },
}));

describe("EmojiPicker", () => {
  it("opens with a touch-pannable overflow scroll region", async () => {
    const user = userEvent.setup();
    render(
      <EmojiPicker
        title="Add reaction"
        ariaLabel="Add reaction"
        onPick={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add reaction" }));

    const scrollRegion = await waitFor(() => {
      const content = document.querySelector('[data-slot="popover-content"]');
      expect(content).toBeTruthy();
      const region = content?.querySelector(".overflow-y-auto");
      expect(region).toBeTruthy();
      return region as HTMLElement;
    });

    expect(scrollRegion.className).toContain("touch-pan-y");
    expect(scrollRegion.className).toContain("overflow-y-auto");
  });

  it("portals popover content into portalContainer when provided", async () => {
    const user = userEvent.setup();
    const host = document.createElement("div");
    host.setAttribute("data-testid", "emoji-portal-host");
    document.body.append(host);

    try {
      render(
        <EmojiPicker
          title="Add reaction"
          ariaLabel="Add reaction"
          portalContainer={host}
          onPick={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Add reaction" }));

      await waitFor(() => {
        const content = host.querySelector('[data-slot="popover-content"]');
        expect(content).toBeTruthy();
      });

      expect(
        document.body.querySelector(
          ':scope > [data-radix-popper-content-wrapper] [data-slot="popover-content"]',
        ),
      ).toBeNull();
      expect(
        host.contains(screen.getByPlaceholderText("Search all emoji")),
      ).toBe(true);
    } finally {
      host.remove();
    }
  });
});
