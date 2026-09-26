import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectModuleTiles } from "@/app/projects/components/project-module-tiles";

const LABELS = {
  calendar: {
    title: "Calendar",
    description: "See upcoming project work",
  },
  comingSoon:
    "More coming soon: Social media, SEO, Email, Paid advertising, Content, PR.",
  fileBrowser: {
    title: "File browser",
    description: "Every file this project produced",
  },
  imageStudio: {
    title: "Image studio",
    description: "Create and refine images with a studio assistant.",
  },
  socialMedia: {
    title: "Social media",
    description: "Posts, calendar, engagement",
  },
};

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

describe("ProjectModuleTiles", () => {
  it("gives a tile only to the areas that open, and names the rest in a line", () => {
    const { container } = render(
      <ProjectModuleTiles
        calendarHref="/projects/project-1/calendar"
        labels={LABELS}
        projectId={PROJECT_ID}
      />,
    );

    const headings = [...container.querySelectorAll("h3")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(["Calendar", "File browser", "Image studio"]);

    // Every tile is a destination. A card that cannot be clicked is not a
    // card here any more.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(screen.getByRole("link", { name: /File browser/ })).toHaveAttribute(
      "href",
      `/drive?view=tasks&projectId=${PROJECT_ID}`,
    );
    expect(screen.getByRole("link", { name: /Calendar/ })).toHaveAttribute(
      "href",
      "/projects/project-1/calendar",
    );
    expect(screen.getByRole("link", { name: /Image studio/ })).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/studio`,
    );

    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
    expect(screen.getByText(LABELS.comingSoon)).toBeInTheDocument();
  });

  it("promotes social media to a tile when the workspace has the route", () => {
    render(
      <ProjectModuleTiles
        calendarHref="/projects/project-1/calendar"
        labels={LABELS}
        projectId={PROJECT_ID}
        socialHref="/projects/project-1/social"
      />,
    );

    expect(screen.getByRole("link", { name: /Social media/ })).toHaveAttribute(
      "href",
      "/projects/project-1/social",
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("drops the calendar tile when the project has no calendar route", () => {
    render(<ProjectModuleTiles labels={LABELS} projectId={PROJECT_ID} />);

    expect(screen.queryByRole("link", { name: /Calendar/ })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
