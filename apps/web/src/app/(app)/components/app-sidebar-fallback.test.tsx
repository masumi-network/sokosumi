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
    for (const href of ["/agents", "/tasks", "/drive"]) {
      expect(
        screen.getByRole("link", {
          name: (_, element) => element.getAttribute("href") === href,
        }),
      ).toBeInTheDocument();
    }
  });

  // New task needs the wizard and a seat, neither of which this frame has, so
  // the shell header leaves it out rather than showing one that may go away.
  it("holds a Workspace switcher placeholder in the header, without New task", () => {
    const { container } = renderFallback();
    const header = container.querySelector('[data-slot="sidebar-header"]');
    const placeholder = header?.querySelector(
      '[data-testid="workspace-switcher-chrome-skeleton"]',
    );

    // Shaped like the loaded switcher: avatar, name bar, chevron, in its
    // order, filling the row on desktop as it does.
    expect(placeholder).not.toBeNull();
    const [avatar, name, chevron] = [...(placeholder?.children ?? [])];
    expect(tokens(avatar?.className ?? "")).toEqual(
      expect.arrayContaining(["rounded-full", "size-4", "md:size-5"]),
    );
    expect(tokens(name?.className ?? "")).toEqual(
      expect.arrayContaining(["h-3", "w-20"]),
    );
    expect(chevron?.tagName.toLowerCase()).toBe("svg");
    expect(tokens(placeholder?.parentElement?.className ?? "")).toEqual(
      expect.arrayContaining(["flex-1", "max-md:hidden"]),
    );
    expect(header?.querySelector("button")).toBeNull();
  });

  // The phone sheet keeps its header as it was: the phone's switcher is in
  // its top bar.
  it("keeps the wordmark for the phone sheet only", () => {
    const { container } = renderFallback();
    const header = container.querySelector('[data-slot="sidebar-header"]');
    const wordmark = header?.querySelector('a[href="/"]');

    expect(wordmark).not.toBeNull();
    expect(tokens(wordmark?.parentElement?.className ?? "")).toContain(
      "md:hidden",
    );
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
    // each a titled heading over its own menu of rooms. The real heading's
    // chevron hides at rest, so the placeholder draws the title alone.
    expect(menus).toHaveLength(2);
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);
    }
    expect(
      tokens(
        headers[0]?.querySelector('[data-slot="skeleton"]')?.className ?? "",
      ),
    ).toContain("w-16");
    expect(
      tokens(
        headers[1]?.querySelector('[data-slot="skeleton"]')?.className ?? "",
      ),
    ).toContain("w-24");

    // Channel rows carry the kind glyph: 16px on a phone, 14px with a
    // pointer, as the row slot sizes it. Direct rows carry one face,
    // except the group row whose second face grows the slot right.
    const channelRows = [
      ...(menus[0]?.querySelectorAll('[data-slot="sidebar-menu-item"]') ?? []),
    ];
    expect(channelRows).toHaveLength(3);
    for (const row of channelRows) {
      const marks = row.querySelectorAll(
        '[data-slot="sidebar-row-slot"] [data-slot="skeleton"]',
      );
      expect(marks).toHaveLength(1);
      expect(tokens(marks[0]?.className ?? "")).toEqual(
        expect.arrayContaining(["size-4", "md:size-3.5"]),
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
      if (rowIndex === 1) {
        expect(tokens(faces[0]?.parentElement?.className ?? "")).toContain(
          "pl-0.5",
        );
      } else {
        expect(tokens(faces[0]?.parentElement?.className ?? "")).not.toContain(
          "pl-0.5",
        );
      }
      for (const [faceIndex, face] of faces.entries()) {
        expect(tokens(face.className)).toEqual(
          expect.arrayContaining(["size-5", "rounded-full"]),
        );
        if (faceIndex > 0) {
          expect(tokens(face.className)).toContain("-ml-1.5");
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

  it("hides off-canvas, leaving no rail behind", () => {
    const { container } = renderFallback();

    expect(
      container
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-collapsible-mode"),
    ).toBe("offcanvas");
  });

  it("leaves the collapse control to the top bar", () => {
    const { container } = renderFallback();
    const header = container.querySelector('[data-slot="sidebar-header"]');

    expect(header?.querySelector('a[href="/"]')).not.toBeNull();
    expect(header?.querySelector("button")).toBeNull();
  });

  it("keeps the skeleton on the same columns as a real row", () => {
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
    const headerName = header?.querySelector('[data-slot="skeleton"]');

    // The same `px-2` + `gap-2` a real row uses, so the 24px slot sits on
    // the 28px axis and the name bar starts on the 48px column.
    for (const el of [header, row]) {
      expect(tokens(el?.className ?? "")).toEqual(
        expect.arrayContaining(["px-2", "gap-2", "h-11", "md:h-7"]),
      );
    }
    expect(tokens(headerName?.className ?? "")).toContain("w-16");
    expect(tokens(name?.className ?? "")).toContain("h-3");
    expect(name?.className).toMatch(/\bw-(14|16|20|24|28|32)\b/);
  });
});
