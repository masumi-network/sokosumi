import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/app/components/history-search-dialog", () => ({
  HistorySearchDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div data-testid="history-search-dialog" /> : null),
}));

import {
  HistorySearchDialogProvider,
  useHistorySearch,
} from "@/app/components/history-search-dialog-provider";

function SearchTrigger() {
  const { openHistorySearch } = useHistorySearch();

  return (
    <button type="button" onClick={openHistorySearch}>
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
