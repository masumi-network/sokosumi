import { AnnouncedFeature } from "@sokosumi/core-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  searchRef,
  wizardRef,
  sidebarRef,
  badgeRef,
  markFeatureSeenMock,
  appleRef,
} = vi.hoisted(() => ({
  appleRef: { current: false },
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

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => appleRef.current,
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

// Alt+N; on a Mac, Option+N is a dead key (it starts "ñ"), so the browser
// reports no "n" and only the physical key says which one was pressed.
const ALT_N = { key: "n", code: "KeyN", altKey: true };
const MAC_OPTION_N = { key: "Dead", code: "KeyN", altKey: true };

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
    appleRef.current = false;
  });

  it("opens the New Task wizard scoped to the selected project", () => {
    searchRef.current = "projectId=p-1";
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "newTask" }));

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it("names its Alt+N shortcut to assistive technology", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "newTask" });

    expect(button).toHaveAttribute("aria-keyshortcuts", "Alt+N");
  });

  it("shows its Alt+N shortcut in a tooltip on keyboard focus", async () => {
    renderButton();
    const button = screen.getByRole("button", { name: "newTask" });

    // A native `title` shows only under a pointer; the tooltip also answers
    // focus, so a keyboard reader learns the shortcut too.
    expect(button).not.toHaveAttribute("title");
    fireEvent.focus(button);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("newTask");
    expect(within(tooltip).getByText("Alt+N").tagName).toBe("KBD");
  });

  it("shows the shortcut as ⌥N on Apple platforms", async () => {
    appleRef.current = true;
    renderButton();

    fireEvent.focus(screen.getByRole("button", { name: "newTask" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("⌥N").tagName).toBe("KBD");
  });

  it.each([
    ["Alt+N", ALT_N],
    ["Option+N on a Mac", MAC_OPTION_N],
  ])("opens the wizard on %s", (_label, keys) => {
    searchRef.current = "projectId=p-1";
    renderButton();

    fireEvent.keyDown(window, keys);

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it.each([
    ["a plain N", { key: "n", code: "KeyN" }],
    ["a plain C", { key: "c", code: "KeyC" }],
    ["Alt with another key", { key: "m", code: "KeyM", altKey: true }],
    ["Alt+N with Ctrl", { ...ALT_N, ctrlKey: true }],
    ["Alt+N with Meta", { ...ALT_N, metaKey: true }],
    ["Alt+N with Shift", { ...ALT_N, shiftKey: true }],
    ["a key repeat", { ...ALT_N, repeat: true }],
  ])("does not open on %s", (_label, keys) => {
    renderButton();

    fireEvent.keyDown(window, keys);

    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
  });

  it("leaves Alt+N alone once another handler has claimed it", () => {
    renderButton();
    const event = new KeyboardEvent("keydown", {
      ...ALT_N,
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
  ])("leaves Alt+N to %s instead of opening", (_label, createTarget) => {
    renderButton();
    const target = createTarget();
    const root = target.parentElement ?? target;
    document.body.append(root);

    fireEvent.keyDown(target, MAC_OPTION_N);

    expect(openNewTaskWizardMock).not.toHaveBeenCalled();
    root.remove();
  });

  // Opening again would remount the wizard and drop what the reader entered.
  it.each(["dialog", "alertdialog", "menu"])(
    "leaves Alt+N alone inside an open %s",
    (role) => {
      renderButton();
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      const control = document.createElement("button");
      surface.append(control);
      document.body.append(surface);

      fireEvent.keyDown(control, ALT_N);

      expect(openNewTaskWizardMock).not.toHaveBeenCalled();
      surface.remove();
    },
  );

  it("offers neither the button nor Alt+N without an assigned seat", () => {
    renderButton({ hasSeat: false });

    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.keyDown(window, ALT_N);
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

  it("marks New task seen when Alt+N opens the wizard", () => {
    badgeRef.current = "shown";
    renderButton();

    fireEvent.keyDown(window, ALT_N);

    expect(markFeatureSeenMock).toHaveBeenCalledWith(AnnouncedFeature.NEW_TASK);
  });
});
