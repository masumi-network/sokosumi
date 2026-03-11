import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";

import LowCreditsNotice from "@/app/components/low-credits-notice";

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      const labels: Record<string, string> = {
        "almostOut.title": "You're almost out of credits",
        "almostOut.description":
          "Open billing to add credits or manage your plan before you run out.",
        "outOfCredits.title": "You're out of credits",
        "outOfCredits.description":
          "Open billing to add credits or manage your plan to keep going.",
        button: "Open billing",
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
      screen.getByText("You're almost out of credits"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open billing to add credits/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute(
      "href",
      "/billing?tab=subscription",
    );
  });

  it("renders the out-of-credits variant with the resolved destination", async () => {
    const view = await LowCreditsNotice({
      kind: "outOfCredits",
      path: "/billing?tab=credits",
    });

    render(view);

    expect(screen.getByText("You're out of credits")).toBeInTheDocument();
    expect(
      screen.getByText(/Open billing to add credits or manage your plan/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute(
      "href",
      "/billing?tab=credits",
    );
  });
});
