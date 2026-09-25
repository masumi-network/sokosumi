import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCOPE_VARIANT_STORAGE_KEY } from "@/app/components/project-scope/variants/scope-variants";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";

const mocks = vi.hoisted(() => ({ scopeSlot: vi.fn() }));

// The variant pieces are out of scope; ScopeOldWay stays real, so the tab's
// stored variant decides what it hides.
vi.mock(
  "@/app/components/project-scope/variants/scope-slot",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/app/components/project-scope/variants/scope-slot")
    >()),
    ScopeSlot: (props: Record<string, unknown>) => {
      mocks.scopeSlot(props);
      return null;
    },
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

function renderBack(backHref: string, backLabel: string) {
  render(
    <ProjectDetailHeader
      backHref={backHref}
      projectName="Example project"
      backLabel={backLabel}
      metadata={[]}
    />,
  );
}

describe("ProjectDetailHeader", () => {
  it("places metadata as a full-width sibling row below the title", () => {
    const { container } = render(
      <ProjectDetailHeader
        projectName="Example project"
        websiteUrl="https://www.example.com/about"
        backLabel="Back"
        metadata={[
          { label: "Updated", value: "Today" },
          { label: "Created", value: "Yesterday" },
        ]}
        actions={<button type="button">Actions</button>}
      />,
    );

    const root = container.firstElementChild;
    expect(root?.className).not.toContain("px-4");
    expect(root?.className).not.toContain("md:px-0");

    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/projects");
    expect(back.className).toContain("hidden");
    expect(back.className).toContain("md:inline-flex");
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute(
      "href",
      "https://www.example.com/about",
    );
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    const titleRow = root?.children[1];
    const metadata = root?.querySelector("dl");
    expect(titleRow).toBeTruthy();
    expect(metadata).toBeTruthy();
    expect(metadata?.className).toContain("w-full");
    expect(titleRow?.contains(metadata!)).toBe(false);
    expect(metadata?.previousElementSibling).toBe(titleRow);
  });

  it("shows a project-specific back link on mobile when requested", () => {
    render(
      <ProjectDetailHeader
        {...{
          backHref: "/projects/project-1",
          showBackOnMobile: true,
        }}
        projectName="Example project"
        backLabel="Back to project"
        metadata={[]}
      />,
    );

    const back = screen.getByRole("link", { name: "Back to project" });
    expect(back).toHaveAttribute("href", "/projects/project-1");
    expect(back.className).not.toContain("hidden");
  });

  it("hands the project-header slot the Calendar beta gate", () => {
    render(
      <ProjectDetailHeader
        projectName="Example project"
        backLabel="Back"
        metadata={[]}
        calendarBeta
      />,
    );

    expect(mocks.scopeSlot).toHaveBeenLastCalledWith({
      place: "project-header",
      calendarBeta: true,
    });
  });

  it("lets a new variant replace only the way back to the list", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "hub");

    renderBack("/projects", "Back to projects");
    renderBack("/projects/p1", "Back to project");

    expect(
      screen.queryByRole("link", { name: "Back to projects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to project" }),
    ).toHaveAttribute("href", "/projects/p1");
  });

  it("keeps both ways back on the current baseline", () => {
    renderBack("/projects", "Back to projects");
    renderBack("/projects/p1", "Back to project");

    expect(
      screen.getByRole("link", { name: "Back to projects" }),
    ).toHaveAttribute("href", "/projects");
    expect(
      screen.getByRole("link", { name: "Back to project" }),
    ).toHaveAttribute("href", "/projects/p1");
  });
});
