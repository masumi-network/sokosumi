import { AnnouncedFeature } from "@sokosumi/core-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchRef, wizardRef, sidebarRef, badgeRef, markFeatureSeenMock } =
  vi.hoisted(() => ({
    searchRef: { current: "" },
    wizardRef: {
      current: null as { openNewTaskWizard: ReturnType<typeof vi.fn> } | null,
    },
    sidebarRef: {
      current: { isMobile: false, setOpenMobile: (_open: boolean) => {} },
    },
    badgeRef: { current: "none" as "shown" | "fading" | "none" },
    markFeatureSeenMock: vi.fn(),
  }));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

// A project-scoped page, so `?projectId=` is the reader's project.
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(searchRef.current),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(",")})` : key,
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => wizardRef.current,
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => sidebarRef.current,
}));

vi.mock("@/app/components/sidebar/components/feature-badges", () => ({
  useNewBadgeState: () => badgeRef.current,
  useMarkFeatureSeen: () => markFeatureSeenMock,
}));

import { SidebarNewTaskButton } from "@/app/components/sidebar/components/sidebar-new-task-button.client";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";

const openNewTaskWizardMock = vi.fn();
const setOpenMobileMock = vi.fn();

function renderButton({ hasSeat = true }: { hasSeat?: boolean } = {}) {
  return render(
    <OrganizationSeatContext value={hasSeat}>
      <SidebarNewTaskButton />
    </OrganizationSeatContext>,
  );
}

describe("SidebarNewTaskButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchRef.current = "";
    wizardRef.current = { openNewTaskWizard: openNewTaskWizardMock };
    sidebarRef.current = { isMobile: false, setOpenMobile: setOpenMobileMock };
    badgeRef.current = "none";
  });

  it("opens the New Task wizard scoped to the selected project", () => {
    searchRef.current = "projectId=p-1";
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "newTask" }));

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it("names its C shortcut to assistive technology", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "newTask" });

    expect(button).toHaveAttribute("aria-keyshortcuts", "C");
  });

  it("shows its C shortcut in a tooltip on keyboard focus", async () => {
    renderButton();
    const button = screen.getByRole("button", { name: "newTask" });

    // A native `title` shows only under a pointer; the tooltip also answers
    // focus, so a keyboard reader learns the shortcut too.
    expect(button).not.toHaveAttribute("title");
    fireEvent.focus(button);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("newTask");
    expect(within(tooltip).getByText("C").tagName).toBe("KBD");
  });

  it("opens the wizard on C", () => {
    searchRef.current = "projectId=p-1";
    renderButton();

    fireEvent.keyDown(window, { key: "c" });

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it.each([
    ["Alt", { altKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["a key repeat", { repeat: true }],
  ])("leaves C alone with %s", (_label, modifiers) => {
    renderButton();

    fireEvent.keyDown(window, { key: "c", ...modifiers });

    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
  });

  it("leaves C alone once another handler has claimed it", () => {
    renderButton();
    const event = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    window.dispatchEvent(event);

    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an input", () => document.createElement("input")],
    ["a textarea", () => document.createElement("textarea")],
    [
      "a contenteditable composer",
      () => {
        const composer = document.createElement("div");
        composer.setAttribute("contenteditable", "true");
        const line = document.createElement("p");
        composer.append(line);
        return line;
      },
    ],
  ])("types C into %s instead of opening", (_label, createTarget) => {
    renderButton();
    const target = createTarget();
    const root = target.parentElement ?? target;
    document.body.append(root);

    fireEvent.keyDown(target, { key: "c" });

    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
    root.remove();
  });

  // Opening again would remount the wizard and drop what the reader entered.
  it.each(["dialog", "alertdialog", "menu"])(
    "leaves C alone inside an open %s",
    (role) => {
      renderButton();
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      const control = document.createElement("button");
      surface.append(control);
      document.body.append(surface);

      fireEvent.keyDown(control, { key: "c" });

      expect(openNewTaskWizardMock).not.toHaveBeenCalled();
      surface.remove();
    },
  );

  it("offers neither the button nor C without an assigned seat", () => {
    renderButton({ hasSeat: false });

    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.keyDown(window, { key: "c" });
    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
  });

  // The Instant Nav shell renders the sidebar outside the wizard's provider.
  it("renders nothing and binds no shortcut outside the wizard's provider", () => {
    wizardRef.current = null;
    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
  });

  it("closes the phone sheet once the wizard opens", () => {
    sidebarRef.current = { isMobile: true, setOpenMobile: setOpenMobileMock };
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "newTask" }));

    expect(openNewTaskWizardMock).toHaveBeenCalledTimes(1);
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("leaves the desktop sidebar as it is", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "newTask" }));

    expect(setOpenMobileMock).not.toHaveBeenCalled();
  });
});

// The hidden ", New" rides after the name; the separator is whatever the
// accessible-name algorithm joins the two spans with.
const NAME_WITH_BADGE = /^newTask\W+new$/;

describe("SidebarNewTaskButton New badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchRef.current = "";
    wizardRef.current = { openNewTaskWizard: openNewTaskWizardMock };
    sidebarRef.current = { isMobile: false, setOpenMobile: setOpenMobileMock };
    badgeRef.current = "none";
  });

  it("carries the New badge while a New task Badge campaign runs", () => {
    badgeRef.current = "shown";
    renderButton();

    expect(
      screen.getByRole("button", { name: NAME_WITH_BADGE }),
    ).toBeInTheDocument();
  });

  it("has no badge without a campaign", () => {
    renderButton();

    expect(screen.getByRole("button", { name: "newTask" })).toBeInTheDocument();
  });

  it("marks New task seen when the button opens the wizard", () => {
    badgeRef.current = "shown";
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: NAME_WITH_BADGE }));

    expect(markFeatureSeenMock).toHaveBeenCalledWith(AnnouncedFeature.NEW_TASK);
  });

  it("marks New task seen when C opens the wizard", () => {
    badgeRef.current = "shown";
    renderButton();

    fireEvent.keyDown(window, { key: "c" });

    expect(markFeatureSeenMock).toHaveBeenCalledWith(AnnouncedFeature.NEW_TASK);
  });
});
