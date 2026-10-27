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

  // The loaded sidebar indents the nav groups behind the project's line, so
  // the shell does too: nothing moves sideways when the title streams in.
  it("keeps the nav groups behind the project scope's line", () => {
    renderFallback();
    const tasks = screen.getByRole("link", {
      name: (_, element) => element.getAttribute("href") === "/tasks",
    });
    const line = tasks.closest(".border-s");

    expect(tokens(line?.className ?? "")).toEqual(
      expect.arrayContaining(["ms-4", "border-sidebar-border"]),
    );
  });

  // The line ties the groups to the project title, so the shell holds the
  // title's place too: a name bar and the selector chevron, in its order.
  it("holds a project title placeholder where the line starts", () => {
    const { container } = renderFallback();
    const placeholder = container.querySelector(
      '[data-testid="project-scope-title-skeleton"]',
    );
    const tasks = screen.getByRole("link", {
      name: (_, element) => element.getAttribute("href") === "/tasks",
    });
    const line = tasks.closest(".border-s");

    if (!placeholder || !line) throw new Error("no title placeholder or line");
    expect(placeholder).toHaveAttribute("aria-hidden");
    expect(line.contains(placeholder)).toBe(false);
    expect(
      placeholder.compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const [name, chevron] = [...placeholder.children];
    expect(tokens(name?.getAttribute("class") ?? "")).toContain("h-3");
    expect(chevron?.getAttribute("class")).toContain("lucide-arrow-left-right");
  });

  // The header mirrors the loaded one, as in Linear: the switcher as wide as
  // its content at the start, then Search and New task at the end. Neither
  // button can work before the frame loads, so both are placeholders.
  it("holds the sidebar header's switcher and buttons as placeholders", () => {
    const { container } = renderFallback();
    const header = container.querySelector('[data-slot="sidebar-header"]');
    const placeholder = header?.querySelector(
      '[data-testid="workspace-switcher-chrome-skeleton"]',
    );
    const actions = [
      ...(header?.querySelectorAll(
        '[data-testid="sidebar-header-action-skeleton"]',
      ) ?? []),
    ];

    // Shaped like the loaded switcher: avatar, name bar, its small selector
    // chevron.
    expect(placeholder).not.toBeNull();
    const [avatar, name, chevron] = [...(placeholder?.children ?? [])];
    expect(tokens(avatar?.className ?? "")).toEqual(
      expect.arrayContaining(["rounded-full", "size-4", "md:size-5"]),
    );
    expect(tokens(name?.className ?? "")).toEqual(
      expect.arrayContaining(["h-3", "w-20"]),
    );
    expect(chevron?.getAttribute("class")).toContain("lucide-arrow-left-right");
    expect(tokens(placeholder?.parentElement?.className ?? "")).toEqual(
      expect.arrayContaining(["flex-1", "max-md:hidden"]),
    );

    // Search, then New task, each an icon button's box, after the switcher.
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      if (!placeholder) break;
      expect(
        placeholder.compareDocumentPosition(action) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(tokens(action.getAttribute("class") ?? "")).toContain("md:size-8");
    }
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

  // As the loaded sidebar: the nav runs into the chat area under its Chats
  // heading, with no rule between them, so the swap draws none either.
  it("heads the room list like the loaded sidebar, with no rule above it", () => {
    const { container } = renderFallback();
    const tasks = screen.getByRole("link", {
      name: (_, element) => element.getAttribute("href") === "/tasks",
    });
    const scoped = tasks.closest(".border-s");
    const roomList = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );

    expect(
      container.querySelector(
        '[data-slot="sidebar-content"] [data-slot="sidebar-separator"]',
      ),
    ).toBeNull();
    expect(scoped?.nextElementSibling).toBe(roomList);
    const heading = roomList?.firstElementChild;
    expect(heading?.getAttribute("data-slot")).not.toBe(
      "sidebar-group-content",
    );
    expect(
      tokens(heading?.querySelector('[data-slot="skeleton"]')?.className ?? ""),
    ).toContain("w-10");
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
