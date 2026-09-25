import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  isApple: false,
  pathname: "/agents",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => mocks.isApple,
}));
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useSelectedScopeProject: () => undefined,
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));
// The menu has its own suite. Here it only has to report a choice. The input
// stands in for its search, which holds focus while the switcher is open.
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: ({
    onSelect,
    onCreate,
    onDone,
  }: {
    onSelect: (projectId: string | null) => void;
    onCreate: (opener: HTMLElement | null) => void;
    onDone?: () => void;
  }) => (
    <div>
      <input aria-label="search" />
      <button
        type="button"
        onClick={() => {
          onSelect("project-2");
          onDone?.();
        }}
      >
        choose
      </button>
      <button
        type="button"
        onClick={() => {
          onDone?.();
          onCreate(null);
        }}
      >
        create
      </button>
    </div>
  ),
}));

import { commandSlots } from "./variant-command";

const ALT_P = { altKey: true, code: "KeyP", key: "p" };
const OPTION_P = { altKey: true, code: "KeyP", key: "π" };

function setup(extra?: ReactNode) {
  const Desktop = commandSlots["header-center"];
  if (!Desktop) throw new Error("No header-center slot");
  render(
    <>
      <button type="button">origin</button>
      <input aria-label="field" />
      <div role="menu">
        <button type="button">menu item</button>
      </div>
      {extra}
      <Desktop />
    </>,
  );
  return {
    origin: screen.getByRole("button", { name: "origin" }),
    pill: screen.getByTestId("project-scope-command-trigger"),
  };
}

/** The switcher by name: some tests render another dialog beside it. */
function dialog() {
  return screen.queryByRole("dialog", { name: "switchLabel" });
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.isApple = false;
  mocks.pathname = "/agents";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandScopeDesktop shortcut", () => {
  it("opens on Alt+KeyP", () => {
    const { origin } = setup();
    // false: the handler cancelled the key.
    expect(fireEvent.keyDown(origin, ALT_P)).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it("opens on Option+KeyP on Apple and cancels the π it would type", () => {
    mocks.isApple = true;
    const { origin } = setup();
    expect(fireEvent.keyDown(origin, OPTION_P)).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it.each([
    ["a held Option+P", { ...OPTION_P, repeat: true }],
    ["a second Option+P", OPTION_P],
  ])("cancels %s while open, so the search types no π", (_name, init) => {
    mocks.isApple = true;
    const { origin } = setup();
    fireEvent.keyDown(origin, OPTION_P);
    // The key lands in the search, an editable field, like in real use.
    const search = screen.getByRole("textbox", { name: "search" });

    expect(fireEvent.keyDown(search, init)).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it("opens on Alt plus the key that types p off Apple (Dvorak)", () => {
    const { origin } = setup();
    fireEvent.keyDown(origin, { altKey: true, code: "KeyR", key: "p" });
    expect(dialog()).not.toBeNull();
  });

  it("ignores the physical KeyP off Apple when it types another letter", () => {
    const { origin } = setup();
    fireEvent.keyDown(origin, { altKey: true, code: "KeyP", key: "l" });
    expect(dialog()).toBeNull();
  });

  it("ignores a key that types p but is not KeyP on Apple", () => {
    mocks.isApple = true;
    const { origin } = setup();
    fireEvent.keyDown(origin, { altKey: true, code: "KeyR", key: "p" });
    expect(dialog()).toBeNull();
  });

  it.each([
    ["a bare P", { code: "KeyP", key: "p" }],
    ["Ctrl+Alt (AltGr)", { ...ALT_P, ctrlKey: true }],
    ["Meta+Alt", { ...ALT_P, metaKey: true }],
    ["Shift+Alt", { ...ALT_P, shiftKey: true }],
    ["a held key", { ...ALT_P, repeat: true }],
    ["Alt with another key", { altKey: true, code: "KeyO", key: "o" }],
  ])("ignores %s", (_name, init) => {
    const { origin } = setup();
    fireEvent.keyDown(origin, init);
    expect(dialog()).toBeNull();
  });

  it("ignores a key another handler already took", () => {
    const { origin } = setup();
    origin.addEventListener("keydown", (event) => event.preventDefault());
    fireEvent.keyDown(origin, ALT_P);
    expect(dialog()).toBeNull();
  });

  it("ignores a key typed into an editable field", () => {
    setup();
    const field = screen.getByRole("textbox", { name: "field" });
    // true: the field still types the character, held or not.
    expect(fireEvent.keyDown(field, ALT_P)).toBe(true);
    expect(fireEvent.keyDown(field, { ...ALT_P, repeat: true })).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("ignores a key pressed inside a surface that owns its keys", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "menu item" }), ALT_P);
    expect(dialog()).toBeNull();
  });

  it.each(["dialog", "alertdialog"])(
    "ignores a key pressed inside role=%s",
    (role) => {
      setup(
        <div role={role}>
          <button type="button">inner</button>
        </div>,
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "inner" }), ALT_P);
      expect(dialog()).toBeNull();
    },
  );

  it("ignores the key while the pill is hidden", () => {
    const { origin, pill } = setup();
    // happy-dom gives every element one rect; a `display: none` pill has none.
    vi.spyOn(pill, "getClientRects").mockReturnValue({
      length: 0,
    } as DOMRectList);
    fireEvent.keyDown(origin, ALT_P);
    expect(dialog()).toBeNull();
  });
});

describe("CommandScopeDesktop key hint", () => {
  it("shows Alt P off Apple", () => {
    const { pill } = setup();
    expect(pill.querySelector("kbd")?.textContent).toBe("Alt P");
    expect(pill.getAttribute("aria-keyshortcuts")).toBe("Alt+P");
  });

  it("shows the Option glyph on Apple and keeps the ARIA shortcut", () => {
    mocks.isApple = true;
    const { pill } = setup();
    expect(pill.querySelector("kbd")?.textContent).toBe("⌥P");
    expect(pill.getAttribute("aria-keyshortcuts")).toBe("Alt+P");
  });
});

describe("CommandScopeDesktop focus", () => {
  it("returns focus to the origin when a shortcut open is cancelled", async () => {
    const user = userEvent.setup();
    const { origin } = setup();
    origin.focus();
    fireEvent.keyDown(origin, ALT_P);
    expect(dialog()).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("returns focus to the pill when a click open is cancelled", async () => {
    const user = userEvent.setup();
    const { origin, pill } = setup();
    origin.focus();
    await user.click(pill);
    expect(dialog()).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });

  it("forgets the shortcut origin once a close uses it", async () => {
    const user = userEvent.setup();
    const { origin, pill } = setup();
    origin.focus();
    fireEvent.keyDown(origin, ALT_P);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(origin));

    await user.click(pill);
    expect(dialog()).not.toBeNull();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });

  it("returns focus to the pill, not the body, after a shortcut from the body", async () => {
    const user = userEvent.setup();
    const { pill } = setup();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, ALT_P);
    expect(dialog()).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });

  it("focuses the pill, not the origin, after a shortcut open and a choice", async () => {
    const user = userEvent.setup();
    const { origin, pill } = setup();
    origin.focus();
    fireEvent.keyDown(origin, ALT_P);

    await user.click(screen.getByRole("button", { name: "choose" }));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });

  it("focuses the pill, not the origin, after a shortcut open and Create", async () => {
    const user = userEvent.setup();
    const { origin, pill } = setup();
    origin.focus();
    fireEvent.keyDown(origin, ALT_P);

    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });
});

function renderMobile() {
  const Mobile = commandSlots["header-mobile"];
  if (!Mobile) throw new Error("No header-mobile slot");
  return render(<Mobile />);
}

describe("CommandScopeMobile", () => {
  it("renders nothing on a chat room", () => {
    mocks.pathname = "/chat/rooms/x";
    const { container } = renderMobile();

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the sheet, navigates once on a choice, and closes", async () => {
    const user = userEvent.setup();
    renderMobile();

    await user.click(screen.getByTestId("project-scope-command-trigger"));
    expect(
      screen.getByRole("dialog", { name: "switchLabel" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "choose" }));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
