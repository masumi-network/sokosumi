import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuButton: ({
    children,
    asChild,
    tooltip,
  }: {
    children: ReactNode;
    asChild?: boolean;
    tooltip?: string;
  }) => (
    <div data-testid="sidebar-menu-button" data-tooltip={tooltip}>
      {asChild && isValidElement(children) ? children : <div>{children}</div>}
    </div>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
}));

vi.mock("@/components/chat/personal-assistant-chrome-store", () => ({
  publishPersonalAssistantChromeVisible: vi.fn(),
}));

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: ({ className }: { className?: string }) => (
    <span data-testid="aurora-orb" className={className} />
  ),
}));

import PersonalAssistantNav from "./personal-assistant-nav.client";

const bots = [
  { id: "bot-1", imageUrl: "https://example.com/1.png", seed: "a" },
  { id: "bot-2", imageUrl: "https://example.com/2.png", seed: "b" },
  { id: "bot-3", imageUrl: "https://example.com/3.png", seed: "c" },
];

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

describe("PersonalAssistantNav collapsed stack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("packs the faces into a size-8 glyph for the icon rail", () => {
    const { container } = render(<PersonalAssistantNav bots={bots} />);
    const stack = container.querySelector('[data-slot="soko-bot-stack"]');
    expect(stack).not.toBeNull();
    expect(tokens(stack?.className ?? "")).toEqual(
      expect.arrayContaining([
        "-space-x-1.5",
        "group-data-[collapsible=icon]:size-8",
        "group-data-[collapsible=icon]:items-center",
        "group-data-[collapsible=icon]:justify-center",
        "group-data-[collapsible=icon]:-space-x-2",
      ]),
    );

    const faces = stack?.querySelectorAll("img") ?? [];
    expect(faces).toHaveLength(3);
    for (const face of faces) {
      expect(tokens(face.className)).toEqual(
        expect.arrayContaining([
          "size-5",
          "group-data-[collapsible=icon]:size-3",
          "group-data-[collapsible=icon]:border",
          "group-data-[collapsible=icon]:border-sidebar",
        ]),
      );
      expect(tokens(face.className)).not.toContain(
        "group-data-[collapsible=icon]:size-4",
      );
    }
  });

  it("keeps a lone collapsed face at the same size as the empty Bot icon", () => {
    const { container } = render(
      <PersonalAssistantNav bots={bots.slice(0, 1)} />,
    );
    const face = container.querySelector('[data-slot="soko-bot-stack"] img');
    expect(face).not.toBeNull();
    expect(tokens(face?.className ?? "")).toEqual(
      expect.arrayContaining([
        "group-data-[collapsible=icon]:size-4",
        "group-data-[collapsible=icon]:border",
      ]),
    );
    expect(tokens(face?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:size-3",
    );
  });

  it("names the row on the sidebar button so the collapsed rail can show it", () => {
    render(<PersonalAssistantNav bots={bots} />);
    expect(screen.getByTestId("sidebar-menu-button")).toHaveAttribute(
      "data-tooltip",
      "sokoBot",
    );
  });

  it("keeps the label in the accessibility tree when the rail collapses", () => {
    render(<PersonalAssistantNav bots={bots} />);
    const label = screen.getByText("sokoBot");
    expect(tokens(label.className)).toContain(
      "group-data-[collapsible=icon]:sr-only",
    );
    expect(tokens(label.className)).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });
});
