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

vi.mock("@/hooks/effects/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => false,
}));

import { AppHeaderFallback } from "@/app/components/app-header-fallback";
import { SidebarProvider } from "@/components/ui/sidebar";

describe("AppHeaderFallback", () => {
  it("reserves the phone action positions and leaves the switcher to the sidebar and rail", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <AppHeaderFallback />
      </SidebarProvider>,
    );
    const controls = container.querySelector(
      '[data-testid="header-workspace-controls"]',
    );
    expect(
      controls?.querySelector(
        '[data-testid="workspace-switcher-chrome-skeleton"]',
      ),
    ).toBeNull();
    expect(controls?.querySelector("#app-sidebar-toggle")).toBeTruthy();
    expect(controls?.querySelectorAll(":scope > .animate-pulse")).toHaveLength(
      2,
    );
  });
});
