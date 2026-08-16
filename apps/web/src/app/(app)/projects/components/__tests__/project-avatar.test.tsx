import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({
    children,
    ...props
  }: { children: ReactNode } & ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  AvatarImage: (props: ComponentProps<"img">) => <img alt="" {...props} />,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

import { ProjectAvatar } from "@/app/projects/components/project-avatar";

describe("ProjectAvatar", () => {
  it("renders the project initial when no logo is set", () => {
    render(<ProjectAvatar name="Autumn Launch" />);

    expect(screen.getByTestId("project-avatar")).toHaveTextContent("A");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the AvatarImage when a logo URL is provided", () => {
    render(
      <ProjectAvatar
        name="Autumn Launch"
        logo="https://blob.example/logo.png"
      />,
    );

    expect(
      screen.getByTestId("project-avatar").querySelector("img"),
    ).toHaveAttribute("src", "https://blob.example/logo.png");
  });
});
