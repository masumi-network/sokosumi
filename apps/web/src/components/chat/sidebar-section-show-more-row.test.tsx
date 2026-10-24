import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    key === "showMore" ? `Show ${values?.count} more` : "Show less",
}));

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { SidebarSectionShowMoreRow } from "./sidebar-section-show-more-row";

function Row() {
  const [showAll, setShowAll] = useState(false);
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarMenu>
            <SidebarSectionShowMoreRow
              hiddenCount={4}
              showAll={showAll}
              onShowAllChange={setShowAll}
            />
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

describe("SidebarSectionShowMoreRow", () => {
  it("counts the hidden rooms and flips to Show less", () => {
    render(<Row />);

    const button = screen.getByRole("button", { name: "Show 4 more" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
