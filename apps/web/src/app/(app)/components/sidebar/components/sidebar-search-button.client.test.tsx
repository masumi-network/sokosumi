import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
let historySearchValue: {
  openHistorySearch: typeof openHistorySearchMock;
  searchShortcutLabel: string;
} | null = null;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => historySearchValue,
}));

import { SidebarSearchButton } from "./sidebar-search-button.client";

function renderButton() {
  return render(<SidebarSearchButton />);
}

describe("SidebarSearchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historySearchValue = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "⌘K",
    };
  });

  it("opens history search", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "open" }));

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
  });

  // Icon only, so the tooltip carries the name and the key cap, like New task.
  it("names the shortcut in its tooltip", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.hover(screen.getByRole("button", { name: "open" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("open");
    expect(tooltip).toHaveTextContent("⌘K");
  });

  it("renders nothing before the search provider mounts", () => {
    historySearchValue = null;
    renderButton();

    expect(screen.queryByRole("button")).toBeNull();
  });
});
