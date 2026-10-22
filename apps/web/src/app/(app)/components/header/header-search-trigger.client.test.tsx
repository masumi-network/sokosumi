import { fireEvent, render, screen } from "@testing-library/react";
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

import { HeaderSearchTrigger } from "./header-search-trigger.client";

describe("HeaderSearchTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historySearchValue = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "⌘K",
    };
  });

  it("opens history search and shows the shortcut", () => {
    render(<HeaderSearchTrigger />);

    const trigger = screen.getByRole("button", { name: "open" });
    expect(trigger).toHaveTextContent("⌘K");
    fireEvent.click(trigger);

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
  });

  it("renders nothing before the search provider mounts", () => {
    historySearchValue = null;
    render(<HeaderSearchTrigger />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
