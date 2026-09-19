vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

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
import { TestQueryProvider } from "@/test/query-provider";

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

function renderFallback() {
  return render(
    <TestQueryProvider>
      <SidebarProvider defaultOpen>
        <AppSidebarFallback />
      </SidebarProvider>
    </TestQueryProvider>,
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

    // `/drive` is desktop-only, and `use-mobile` is mocked to desktop above.
    for (const href of [
      "/agents",
      "/projects",
      "/tasks",
      "/drive",
      "/history",
    ]) {
      expect(
        screen.getByRole("link", {
          name: (_, element) => element.getAttribute("href") === href,
        }),
      ).toBeInTheDocument();
    }
  });

  it("leaves the session-backed surfaces as placeholders", () => {
    const { container } = renderFallback();

    const roomList = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );
    const menus = [
      ...(roomList?.querySelectorAll('[data-slot="sidebar-menu"]') ?? []),
    ];
    const headers = [
      ...(roomList?.querySelectorAll(
        '[data-slot="sidebar-group-content"] > div',
      ) ?? []),
    ];

    // The two sections every reader has — Channels and Direct Messages —
    // each a heading of chevron and title over its own menu of rooms.
    expect(menus).toHaveLength(2);
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    }
    expect(
      tokens(
        headers[0]?.querySelectorAll('[data-slot="skeleton"]')[1]?.className ??
          "",
      ),
    ).toContain("w-16");
    expect(
      tokens(
        headers[1]?.querySelectorAll('[data-slot="skeleton"]')[1]?.className ??
          "",
      ),
    ).toContain("w-24");

    // Channel rows carry both of ChannelRoomMark's shapes. Direct rows carry
    // one face, except the group row whose second face grows the slot right.
    const channelRows = [
      ...(menus[0]?.querySelectorAll('[data-slot="sidebar-menu-item"]') ?? []),
    ];
    expect(channelRows).toHaveLength(3);
    for (const row of channelRows) {
      const marks = row.querySelectorAll(
        '[data-slot="sidebar-row-slot"] [data-slot="skeleton"]',
      );
      expect(marks).toHaveLength(2);
      expect(tokens(marks[0]?.className ?? "")).toEqual(
        expect.arrayContaining([
          "size-4",
          "group-data-[collapsible=icon]:hidden",
        ]),
      );
      expect(tokens(marks[1]?.className ?? "")).toEqual(
        expect.arrayContaining([
          "size-5",
          "hidden",
          "group-data-[collapsible=icon]:block",
        ]),
      );
      expect(
        row.querySelectorAll(
          '[data-slot="sidebar-row-slot"] ~ [data-slot="skeleton"]',
        ),
      ).toHaveLength(1);
    }

    const directRows = [
      ...(menus[1]?.querySelectorAll('[data-slot="sidebar-menu-item"]') ?? []),
    ];
    expect(directRows).toHaveLength(3);
    for (const [rowIndex, row] of directRows.entries()) {
      const faces = [
        ...row.querySelectorAll(
          '[data-slot="sidebar-row-slot"] [data-slot="skeleton"]',
        ),
      ];
      expect(faces).toHaveLength(rowIndex === 1 ? 2 : 1);
      for (const [faceIndex, face] of faces.entries()) {
        expect(tokens(face.className)).toEqual(
          expect.arrayContaining(["size-5", "rounded-full"]),
        );
        if (faceIndex > 0) {
          expect(tokens(face.className)).toEqual(
            expect.arrayContaining([
              "-ml-1.5",
              "group-data-[collapsible=icon]:hidden",
            ]),
          );
        } else {
          expect(tokens(face.className)).not.toContain("-ml-1.5");
        }
      }
      expect(
        row.querySelectorAll(
          '[data-slot="sidebar-row-slot"] ~ [data-slot="skeleton"]',
        ),
      ).toHaveLength(1);
    }

    // The account chip: an avatar over name and plan lines.
    expect(
      container
        .querySelector('[data-slot="sidebar-footer"]')
        ?.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBe(3);
  });

  it("keeps both logo states in the DOM so a collapsed boot script can hide the wordmark", () => {
    const { container } = render(
      <TestQueryProvider>
        <SidebarProvider defaultOpen={false}>
          <AppSidebarFallback />
        </SidebarProvider>
      </TestQueryProvider>,
    );

    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    const expand = container.querySelector(
      'button[aria-label="expandSidebar"]',
    );
    expect(expand).not.toBeNull();
    expect(tokens(expand?.className ?? "")).toEqual(
      expect.arrayContaining([
        "hidden",
        "group-data-[collapsible=icon]:md:flex",
      ]),
    );
    expect(tokens(expand?.className ?? "")).not.toContain("md:flex");
  });

  it("gives the room skeleton the rail's collapsed geometry", () => {
    const { container } = renderFallback();
    const skeleton = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );
    const header = skeleton?.querySelector(
      '[data-slot="sidebar-group-content"] > div',
    );
    const row = skeleton?.querySelector(
      '[data-slot="sidebar-menu-item"] > div',
    );
    const mark = row?.querySelector('[data-slot="sidebar-row-slot"]');

    // The section header stays on the rail as one 32px square, on the same
    // 28px leading axis (`ml-1` + `pl-1`) every real row uses there.
    expect(tokens(header?.className ?? "")).toEqual(
      expect.arrayContaining([
        "md:h-8",
        "group-data-[collapsible=icon]:w-8!",
        "group-data-[collapsible=icon]:ml-1",
        "group-data-[collapsible=icon]:pl-1!",
        "group-data-[collapsible=icon]:justify-start!",
      ]),
    );
    expect(tokens(header?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
    // A Sidebar row's height: one rule for both states, so nothing under the
    // skeleton moves when the real list arrives or the sidebar toggles.
    expect(tokens(row?.className ?? "")).toEqual(
      expect.arrayContaining([
        "h-11",
        "md:h-8",
        "px-2",
        "gap-2",
        "group-data-[collapsible=icon]:w-8!",
        "group-data-[collapsible=icon]:ml-1",
        "group-data-[collapsible=icon]:pl-1!",
        "group-data-[collapsible=icon]:justify-start!",
      ]),
    );
    expect(tokens(row?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:px-0",
    );
    // The mark sits in the shared slot at one size, like every real row's.
    expect(mark?.getAttribute("data-slot")).toBe("sidebar-row-slot");
    expect(tokens(mark?.className ?? "")).toContain("min-w-6");
  });

  it("keeps the expanded skeleton on the same columns as a real row", () => {
    const { container } = renderFallback();
    const skeleton = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );
    const header = skeleton?.querySelector(
      '[data-slot="sidebar-group-content"] > div',
    );
    const row = skeleton?.querySelector(
      '[data-slot="sidebar-menu-item"] > div',
    );
    // The name is the row's own child, not one of the marks inside the slot.
    const name = row?.querySelector(
      '[data-slot="sidebar-row-slot"] ~ [data-slot="skeleton"]',
    );
    const headerName = header?.querySelectorAll('[data-slot="skeleton"]')[1];

    // Expanded: the same `px-2` + `gap-2` a real row uses, so the 24px slot
    // sits on the 28px axis and the name bar starts on the 48px column.
    for (const el of [header, row]) {
      expect(tokens(el?.className ?? "")).toEqual(
        expect.arrayContaining(["px-2", "gap-2", "h-11", "md:h-8"]),
      );
    }
    expect(tokens(headerName?.className ?? "")).toContain("w-16");
    expect(tokens(headerName?.className ?? "")).toContain(
      "group-data-[collapsible=icon]:max-w-0",
    );
    expect(tokens(headerName?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
    expect(tokens(name?.className ?? "")).toEqual(
      expect.arrayContaining(["h-3", "group-data-[collapsible=icon]:max-w-0"]),
    );
    expect(tokens(name?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
    expect(name?.className).toMatch(/\bw-(14|16|20|24|28|32)\b/);
  });
});
