import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/developer/api-keys" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { DeveloperSectionsHeader } from "./developer-sections-header";

describe("DeveloperSectionsHeader", () => {
  beforeEach(() => {
    pathname.current = "/developer/api-keys";
  });

  it("names the area and marks the current section", () => {
    render(<DeveloperSectionsHeader showVendors={false} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "title" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "sectionsLabel" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tabs.apiKeys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "tabs.oauthClients" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("lists Vendors only for vendor admins", () => {
    const { rerender } = render(
      <DeveloperSectionsHeader showVendors={false} />,
    );
    expect(
      screen.queryByRole("link", { name: "tabs.vendors" }),
    ).not.toBeInTheDocument();

    rerender(<DeveloperSectionsHeader showVendors />);
    expect(screen.getByRole("link", { name: "tabs.vendors" })).toHaveAttribute(
      "href",
      "/developer/vendors",
    );
  });

  // Detail pages keep their own header and Back link.
  it("renders nothing below a section", () => {
    pathname.current = "/developer/coworkers/cw_1";
    const { container } = render(
      <DeveloperSectionsHeader showVendors={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
