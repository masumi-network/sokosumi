import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

function SidebarStateProbe() {
  const { open, state } = useSidebar();
  return (
    <div data-testid="sidebar-state" data-open={String(open)} data-state={state} />
  );
}

describe("SidebarProvider cookie preference", () => {
  beforeEach(() => {
    document.cookie =
      "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("restores collapsed preference from cookie before paint", async () => {
    document.cookie = "sidebar_state=false; path=/";

    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarStateProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("sidebar-state")).toHaveAttribute("data-open", "false");
      expect(getByTestId("sidebar-state")).toHaveAttribute(
        "data-state",
        "collapsed",
      );
    });
  });

  it("keeps defaultOpen when cookie is absent", async () => {
    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarStateProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("sidebar-state")).toHaveAttribute("data-open", "true");
      expect(getByTestId("sidebar-state")).toHaveAttribute(
        "data-state",
        "expanded",
      );
    });
  });
});
