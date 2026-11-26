import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import de from "@/messages/de.json";

import { OfferDetailDialog, type OfferDetailItem } from "./offer-card";

const item: OfferDetailItem = {
  offer: {
    title: "Brand & Campaign Strategy",
    prompt: "Plan a brand campaign.",
    description: "Develop a distinctive brand campaign.",
    outputs: [{ type: "image", url: "https://example.com/a.png" }],
  },
  coworkerName: "Elena",
  coworkerAvatar: null,
};

describe("OfferDetailDialog", () => {
  it("draws one localized Close button on its own surface, readable over a white preview", () => {
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <OfferDetailDialog
          item={item}
          onClose={onClose}
          labels={{ start: "Aufgabe starten" }}
        />
      </NextIntlClientProvider>,
    );

    const close = screen.getByRole("button", { name: "Schließen" });
    expect(screen.getAllByRole("button", { name: "Schließen" })).toHaveLength(
      1,
    );
    // The preview fills the top of the dialog on phones; a bare, faded X
    // vanished on a white document in dark mode.
    expect(close).toHaveClass("bg-background", "border-border");
    expect(close).not.toHaveClass("opacity-70");

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
