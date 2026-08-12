import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CookieBanner } from "@/components/analytics/cookie-banner";
import { CONSENT_COOKIE } from "@/lib/analytics/consent";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function clearConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
}

describe("CookieBanner mobile", () => {
  beforeEach(() => {
    clearConsentCookie();
    vi.stubGlobal("innerWidth", 390);
  });

  afterEach(() => {
    clearConsentCookie();
    vi.unstubAllGlobals();
  });

  it("opens full-bleed at the bottom with left 0", async () => {
    render(<CookieBanner />);

    const dialog = await screen.findByRole("dialog", { name: "title" });
    await waitFor(() => {
      expect(dialog).toHaveStyle({ left: "0px" });
    });
    expect(screen.getByRole("button", { name: "acceptAll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "rejectAll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "manage" })).toBeVisible();
  });

  it("expands preferences then reject hides the banner", async () => {
    render(<CookieBanner />);

    fireEvent.click(await screen.findByRole("button", { name: "manage" }));
    expect(screen.getByText("analyticsTitle")).toBeVisible();
    expect(screen.getByText("marketingTitle")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "rejectAll" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.cookie).toContain(CONSENT_COOKIE);
  });
});
