import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  isApple: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/agents",
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
// The menu has its own suite. Here it only has to report a choice.
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

function setup() {
  const Desktop = commandSlots["header-center"];
  if (!Desktop) throw new Error("No header-center slot");
  render(
    <>
      <button type="button">origin</button>
      <input aria-label="field" />
      <div role="menu">
        <button type="button">menu item</button>
      </div>
      <Desktop />
    </>,
  );
  return {
    origin: screen.getByRole("button", { name: "origin" }),
    pill: screen.getByTestId("project-scope-command-trigger"),
  };
}

function dialog() {
  return screen.queryByRole("dialog");
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.isApple = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandScopeDesktop shortcut", () => {
  it("opens on Alt+KeyP", () => {
    const { origin } = setup();
    fireEvent.keyDown(origin, ALT_P);
    expect(dialog()).not.toBeNull();
  });

  it("opens on Option+KeyP on Apple, which types π", () => {
    mocks.isApple = true;
    const { origin } = setup();
    fireEvent.keyDown(origin, { altKey: true, code: "KeyP", key: "π" });
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
    fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), ALT_P);
    expect(dialog()).toBeNull();
  });

  it("ignores a key pressed inside a surface that owns its keys", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "menu item" }), ALT_P);
    expect(dialog()).toBeNull();
  });

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
