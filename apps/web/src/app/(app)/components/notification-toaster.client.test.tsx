import { render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

import { NotificationToaster } from "./notification-toaster.client";

describe("NotificationToaster", () => {
  it("names its landmark apart from the root toaster", () => {
    render(
      <>
        <Toaster />
        <NotificationToaster />
      </>,
    );

    const names = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.some((name) => name?.startsWith("toastRegion"))).toBe(true);
  });
});
