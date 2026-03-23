import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@testing-library/react";

import LowCreditsNotice from "@/app/components/low-credits-notice";

vi.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const labels: Record<string, string> = {
        "subscription.almostOut.title": "Your credits are running low",
        "subscription.almostOut.description":
          "Open billing to choose a subscription before you run out.",
        "subscription.outOfCredits.title": "Start a subscription to continue",
        "subscription.outOfCredits.description":
          "Open billing to choose a subscription and keep working.",
        "subscription.button": "View subscription plans",
        "credits.almostOut.title": "Your credits are running low",
        "credits.almostOut.description":
          "Open billing to manage your subscription and add credits before work is interrupted.",
        "credits.outOfCredits.title": "Your credits are used up",
        "credits.outOfCredits.description":
          "Open billing to manage your subscription and add credits to keep going.",
        "credits.button": "Open billing",
      };

      return labels[key] ?? key;
    }),
}));

describe("LowCreditsNotice", () => {
  it("renders the almost-out variant with the resolved destination", async () => {
    const view = await LowCreditsNotice({
      kind: "lowCredits",
      path: "/billing?tab=subscription",
    });

    render(view);

    expect(
      screen.getByText("Your credits are running low"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open billing to choose a subscription/i),
    ).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass(
      "border-semantic-warning-tertiary",
      "bg-semantic-warning-quinary",
      "text-semantic-warning",
    );
    const cta = screen.getByRole("link", { name: "View subscription plans" });
    expect(cta).toHaveAttribute("href", "/billing?tab=subscription");
    expect(cta.closest("[data-slot='button']")).toHaveClass(
      "border-semantic-warning-tertiary",
      "text-semantic-warning",
    );
    expect(cta.querySelector("svg")).not.toBeNull();
  });

  it("renders the arrow icon inside the CTA", async () => {
    const view = await LowCreditsNotice({
      kind: "lowCredits",
      path: "/billing?tab=subscription",
    });

    render(view);

    expect(
      screen
        .getByRole("link", { name: "View subscription plans" })
        .querySelector("svg"),
    ).not.toBeNull();
  });

  it("renders the paid-plan low-credits variant without subscription in the title", async () => {
    const view = await LowCreditsNotice({
      kind: "lowCredits",
      path: "/billing?tab=credits",
    });

    render(view);

    expect(
      screen.getByText("Your credits are running low"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Open billing to manage your subscription and add credits/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute(
      "href",
      "/billing?tab=credits",
    );
  });

  it("renders the paid-plan out-of-credits variant without subscription in the title", async () => {
    const view = await LowCreditsNotice({
      kind: "outOfCredits",
      path: "/billing?tab=credits",
    });

    render(view);

    expect(screen.getByText("Your credits are used up")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Open billing to manage your subscription and add credits/i,
      ),
    ).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass(
      "border-semantic-destructive-tertiary",
      "bg-semantic-destructive-quinary",
      "text-semantic-destructive",
    );
    const cta = screen.getByRole("link", { name: "Open billing" });
    expect(cta).toHaveAttribute("href", "/billing?tab=credits");
    expect(cta.closest("[data-slot='button']")).toHaveClass(
      "border-semantic-destructive-tertiary",
      "text-semantic-destructive",
    );
  });
});
