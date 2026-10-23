import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CookieBanner } from "@/components/analytics/cookie-banner";
import { CONSENT_COOKIE } from "@/lib/analytics/consent";

const pathname = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: pathname }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function clearConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
}

describe("CookieBanner mobile", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/signin");
    clearConsentCookie();
    vi.stubGlobal("innerWidth", 390);
  });

  it.each(["/n/weekly/embed", "/n/weekly/embed/"])(
    "keeps signup embeds free of the global cookie banner: %s",
    (path) => {
      pathname.mockReturnValue(path);
      render(<CookieBanner />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.cookie).not.toContain(CONSENT_COOKIE);
    },
  );

  it.each(["/n/weekly", "/n/weekly/archive", "/n/weekly/embed/child"])(
    "preserves the cookie banner on other newsletter routes: %s",
    async (path) => {
      pathname.mockReturnValue(path);
      render(<CookieBanner />);
      expect(
        await screen.findByRole("dialog", { name: "title" }),
      ).toBeVisible();
    },
  );

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
