import type { VendorMembership } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { DeveloperVendorsList } from "./developer-vendors-list";

// Loads every URL except ones containing "broken", synchronously.
class FakeImage {
  naturalWidth = 0;
  complete = false;
  private listeners: Record<string, () => void> = {};
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  removeEventListener() {}
  set src(value: string) {
    this.complete = true;
    this.naturalWidth = value.includes("broken") ? 0 : 100;
  }
}

const vendor = {
  id: "v1",
  name: "Masumi",
  slug: "masumi",
  logos: { light: "/logo-black.svg", dark: "/broken-white.svg" },
} as VendorMembership;

describe("DeveloperVendorsList", () => {
  it("shows the initial in the theme whose logo fails, the logo in the other", async () => {
    vi.stubGlobal("Image", FakeImage);
    render(await DeveloperVendorsList({ adminVendors: [vendor] }));

    const light = screen.getByTestId("vendor-logo-light");
    const dark = screen.getByTestId("vendor-logo-dark");
    expect(within(light).getByRole("img", { name: "Masumi" })).toHaveAttribute(
      "src",
      "/logo-black.svg",
    );
    // AvatarFallback hides itself with CSS (`:has`) while an image is mounted
    // in its own Avatar, so the dark avatar must hold no image at all.
    expect(within(dark).queryByRole("img")).not.toBeInTheDocument();
    expect(within(dark).getByText("M")).toBeInTheDocument();
  });
});
