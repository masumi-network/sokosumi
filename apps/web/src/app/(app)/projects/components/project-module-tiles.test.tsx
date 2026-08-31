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

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

describe("ProjectModuleTiles", () => {
  it("renders File Browser first as an active link and keeps others Coming soon", () => {
    const { container } = render(
      <ProjectModuleTiles labels={LABELS} projectId={PROJECT_ID} />,
    );

    const headings = [...container.querySelectorAll("h3")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      "File Browser",
      "SEO",
      "Social Media",
      "Email",
      "Paid Advertising",
      "Content",
      "PR",
    ]);

    const fileBrowserLink = screen.getByRole("link", { name: /File Browser/i });
    expect(fileBrowserLink).toHaveAttribute(
      "href",
      `/drive?view=tasks&projectId=${PROJECT_ID}`,
    );
    expect(fileBrowserLink).not.toHaveAttribute("aria-disabled", "true");
    expect(fileBrowserLink).not.toHaveTextContent("Coming soon");

    const disabledTiles = [
      ...container.querySelectorAll('[aria-disabled="true"]'),
    ];
    expect(disabledTiles).toHaveLength(6);
    expect(
      disabledTiles.map((tile) => tile.querySelector("h3")?.textContent),
    ).toEqual([
      "SEO",
      "Social Media",
      "Email",
      "Paid Advertising",
      "Content",
      "PR",
    ]);
    expect(screen.getAllByText("Coming soon")).toHaveLength(6);
    expect(
      screen.getByText("Every file this project produced"),
    ).toBeInTheDocument();
    expect(
      disabledTiles.every((tile) => tile.className.includes("cursor-default")),
    ).toBe(true);
    expect(
      disabledTiles.every((tile) => tile.className.includes("rounded-xl")),
    ).toBe(true);
    expect(
      disabledTiles.every((tile) => !tile.className.includes("rounded-none")),
    ).toBe(true);

    expect(
      screen.queryByRole("link", { name: /SEO/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Social Media/i }),
    ).not.toBeInTheDocument();
  });
});
