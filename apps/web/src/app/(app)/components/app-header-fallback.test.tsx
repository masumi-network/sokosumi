import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => false,
}));

import { AppHeaderFallback } from "@/app/components/app-header-fallback";
import { SidebarProvider } from "@/components/ui/sidebar";

function tokens(element: Element | null | undefined): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("AppHeaderFallback", () => {
  // From md the Workspace switcher is the sidebar header's, so the shell's
  // top bar shows no placeholder for it there; the phone's top bar keeps one.
  it("holds the switcher placeholder for the phone only", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <AppHeaderFallback />
      </SidebarProvider>,
    );
    const trailing = container.querySelector('[data-testid="header-trailing"]');
    const placeholders = trailing?.querySelectorAll(
      '[data-testid="workspace-switcher-chrome-skeleton"]',
    );

    expect(placeholders).toHaveLength(1);
    expect(tokens(placeholders?.[0]?.parentElement)).toContain("md:hidden");
    // Nothing else in the trailing area stands in for the old desktop chip.
    expect(trailing?.children).toHaveLength(1);
  });

  // From md, Search sits in the sidebar header, so the shell's top bar
  // holds no placeholder for it.
  it("holds no Search placeholder in the top bar", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <AppHeaderFallback />
      </SidebarProvider>,
    );

    expect(
      container.querySelector('[data-testid="header-search-skeleton"]'),
    ).toBeNull();
    const desktopPlaceholders = [
      ...container.querySelectorAll(".animate-pulse"),
    ].filter((element) => tokens(element).includes("md:flex"));
    expect(desktopPlaceholders).toHaveLength(0);
  });

  // The phone's switcher is the avatar alone up to md (MOBILE_BREAKPOINT
  // 768), so its placeholder draws no name bar there either.
  it("leaves the name bar out of the phone's placeholder", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <AppHeaderFallback />
      </SidebarProvider>,
    );
    const placeholder = container.querySelector(
      '[data-testid="header-trailing"] [data-testid="workspace-switcher-chrome-skeleton"]',
    );
    const [, name] = [...(placeholder?.children ?? [])];

    expect(tokens(name)).toEqual(
      expect.arrayContaining(["h-3", "max-md:hidden"]),
    );
  });
});
