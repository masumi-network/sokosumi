import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectModuleTiles } from "@/app/projects/components/project-module-tiles";

const LABELS = {
  comingSoon: "Coming soon",
  seo: { title: "SEO", description: "Keywords, rankings, audits" },
  socialMedia: {
    title: "Social Media",
    description: "Posts, calendar, engagement",
  },
  email: { title: "Email", description: "Campaigns and sequences" },
  paidAdvertising: {
    title: "Paid Advertising",
    description: "Ads, budgets, performance",
  },
  content: { title: "Content", description: "Briefs, drafts, publishing" },
  pr: { title: "PR", description: "Press, outreach, coverage" },
  fileBrowser: {
    title: "File Browser",
    description: "Every file this project produced",
  },
};

describe("ProjectModuleTiles", () => {
  it("renders all disabled modules in dashboard order", () => {
    const { container } = render(<ProjectModuleTiles labels={LABELS} />);

    const tiles = [...container.querySelectorAll('[aria-disabled="true"]')];
    expect(tiles).toHaveLength(7);
    expect(tiles.map((tile) => tile.querySelector("h3")?.textContent)).toEqual([
      "SEO",
      "Social Media",
      "Email",
      "Paid Advertising",
      "Content",
      "PR",
      "File Browser",
    ]);
    expect(screen.getAllByText("Coming soon")).toHaveLength(7);
    expect(
      screen.getByText("Every file this project produced"),
    ).toBeInTheDocument();
    expect(
      tiles.every((tile) => tile.className.includes("cursor-default")),
    ).toBe(true);
    expect(tiles.every((tile) => tile.className.includes("rounded-xl"))).toBe(
      true,
    );
    expect(
      tiles.every((tile) => !tile.className.includes("rounded-none")),
    ).toBe(true);
  });
});
