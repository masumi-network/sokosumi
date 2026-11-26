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

function tokens(element: Element | null | undefined): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("AppHeaderFallback", () => {
  it("reserves the workspace name and action positions at both sizes", () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <AppHeaderFallback />
      </SidebarProvider>,
    );
    const controls = container.querySelector(
      '[data-testid="header-workspace-controls"]',
    );
    const placeholder = controls?.querySelector(
      '[data-testid="workspace-switcher-chrome-skeleton"]',
    );
    const [, name] = [...(placeholder?.children ?? [])];
    expect(tokens(name)).toContain("h-3");
    expect(tokens(name)).not.toContain("max-md:hidden");
    expect(controls?.querySelector("#app-sidebar-toggle")).toBeTruthy();
    expect(controls?.querySelectorAll(":scope > .animate-pulse")).toHaveLength(
      2,
    );
  });
});
