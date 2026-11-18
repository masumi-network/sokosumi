import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

// A real Radix dialog with no DialogTrigger, like the app's search dialog.
vi.mock("@/app/components/history-search-dialog", async () => {
  const { CommandDialog, CommandInput } = await import(
    "@/components/ui/command"
  );
  return {
    HistorySearchDialog: ({
      open,
      onOpenChange,
      onCloseAutoFocus,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onCloseAutoFocus?: (event: Event) => void;
    }) => (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        contentProps={{ onCloseAutoFocus }}
      >
        <div data-testid="history-search-dialog" />
        <CommandInput aria-label="Search query" />
      </CommandDialog>
    ),
  };
});

import {
  HistorySearchDialogProvider,
  useHistorySearch,
} from "@/app/components/history-search-dialog-provider";

function SearchTrigger() {
  const { openHistorySearch } = useHistorySearch();

  return (
    <button
      type="button"
      onClick={(event) => openHistorySearch(event.currentTarget)}
    >
      Open search
    </button>
  );
}

describe("HistorySearchDialogProvider", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not throw when event.key is undefined", () => {
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );

    expect(() => {
      fireEvent.keyDown(window, { key: undefined, metaKey: true });
    }).not.toThrow();

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
  });

  it("opens search dialog on Cmd+K", () => {
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByTestId("history-search-dialog")).toBeInTheDocument();
  });

  it("opens search dialog on Ctrl+K", () => {
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByTestId("history-search-dialog")).toBeInTheDocument();
  });

  it("ignores Cmd+K when an input element is the event target", () => {
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();

    document.body.removeChild(input);
  });

  it("returns focus to the Search button that opened it after Escape", async () => {
    const user = userEvent.setup();
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );
    const opener = screen.getByRole("button", { name: "Open search" });

    await user.click(opener);
    expect(screen.getByLabelText("Search query")).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps the original opener when the shortcut is pressed while open", async () => {
    const user = userEvent.setup();
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );
    const opener = screen.getByRole("button", { name: "Open search" });

    await user.click(opener);
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("ignores non-matching keys", () => {
    render(
      <HistorySearchDialogProvider activeOrganizationId={null}>
        <SearchTrigger />
      </HistorySearchDialogProvider>,
    );

    fireEvent.keyDown(window, { key: "j", metaKey: true });

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
  });
});
