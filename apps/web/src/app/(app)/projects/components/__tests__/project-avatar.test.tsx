import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";

describe("ProjectAvatar", () => {
  it("renders the project initial when no logo is set", () => {
    render(<ProjectAvatar name="Autumn Launch" />);

    expect(screen.getByTestId("project-avatar")).toHaveTextContent("A");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the initial fallback when a logo URL is provided", () => {
    render(
      <ProjectAvatar
        name="Autumn Launch"
        logo="https://blob.example/logo.png"
      />,
    );

    expect(screen.getByTestId("project-avatar")).toHaveTextContent("A");
  });
});
