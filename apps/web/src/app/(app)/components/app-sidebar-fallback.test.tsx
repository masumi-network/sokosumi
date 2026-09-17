import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
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
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { AppSidebarFallback } from "@/app/components/app-sidebar-fallback";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderFallback() {
  return render(
    <SidebarProvider defaultOpen>
      <AppSidebarFallback />
    </SidebarProvider>,
  );
}

/**
 * The boot shell's nav is the real `MenuItems`, not a placeholder for it, so
 * nothing in it moves when the streamed sidebar replaces this frame. A
 * regression here is silent — the shell would still render, just blank again
 * — so the links are asserted rather than the markup around them.
 */
describe("AppSidebarFallback", () => {
  it("renders the real nav links rather than placeholders", () => {
    renderFallback();

    for (const href of ["/agents", "/projects", "/tasks", "/history"]) {
      expect(
        screen.getByRole("link", {
          name: (_, element) => element.getAttribute("href") === href,
        }),
      ).toBeInTheDocument();
    }
  });

  it("leaves the session-backed surfaces as placeholders", () => {
    const { container } = renderFallback();

    // Room list (5 rows × leading mark + name) plus the account chip's
    // avatar and two label lines.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(
      15,
    );
  });
});
