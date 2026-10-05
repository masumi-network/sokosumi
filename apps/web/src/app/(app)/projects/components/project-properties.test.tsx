import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectProperties } from "@/app/projects/components/project-properties";

const LABELS = {
  title: "Properties",
  identifier: "Identifier",
  website: "Website",
  updated: "Updated",
  created: "Created",
};

describe("ProjectProperties", () => {
  it("pairs each value with its label as a term, label first", () => {
    render(
      <ProjectProperties
        labels={LABELS}
        identifier="SOK"
        websiteUrl="https://www.example.com/about"
        updatedAt="Today"
        createdAt="Yesterday"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Properties" }),
    ).toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Identifier", "Website", "Updated", "Created"]);

    // The label is read before the value, even though it is drawn after it.
    for (const term of screen.getAllByRole("term")) {
      const row = term.parentElement as HTMLElement;
      expect(row.firstElementChild).toBe(term);
      // A <dl> row may hold only its <dt> and <dd>.
      expect([...row.children].map((child) => child.tagName)).toEqual([
        "DT",
        "DD",
      ]);
      expect(term.className).toContain("order-last");
      expect(within(row).getByRole("definition")).toBeInTheDocument();
    }

    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("href", "https://www.example.com/about");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Truncation is recoverable: the full URL is on hover.
    expect(link).toHaveAttribute("title", "https://www.example.com/about");
    expect(screen.getByText("SOK")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });

  it("drops the identifier row when the project has none", () => {
    render(
      <ProjectProperties
        labels={LABELS}
        identifier={null}
        websiteUrl="https://www.example.com/about"
        updatedAt="Today"
        createdAt="Yesterday"
      />,
    );

    expect(screen.queryByText("Identifier")).not.toBeInTheDocument();
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      ["Website", "Updated", "Created"],
    );
  });

  it("drops the website row when the project has none", () => {
    render(
      <ProjectProperties
        labels={LABELS}
        websiteUrl={null}
        updatedAt="Today"
        createdAt="Yesterday"
      />,
    );

    expect(screen.queryByText("Website")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      ["Updated", "Created"],
    );
  });
});
