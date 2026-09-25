import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeaderWorkspaceLabel } from "./header-workspace-label";

describe("HeaderWorkspaceLabel", () => {
  it("renders the workspace identity without exposing a decorative avatar", () => {
    render(
      <button type="button">
        <HeaderWorkspaceLabel
          name="Acme"
          email="ada@example.com"
          avatar={<span aria-hidden>avatar</span>}
        />
      </button>,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Acme ada@example.com",
    );
    expect(screen.getByText("avatar")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("keeps the account email while the workspace identity loads", () => {
    render(
      <HeaderWorkspaceLabel
        name={null}
        email="ada@example.com"
        avatar={<span>stale avatar</span>}
      />,
    );

    expect(screen.getByTestId("workspace-switcher-skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText("stale avatar")).not.toBeInTheDocument();
  });
});
