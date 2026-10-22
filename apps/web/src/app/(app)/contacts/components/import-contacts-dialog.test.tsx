import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportContactsDialog } from "./import-contacts-dialog";

const { importTable, finish } = vi.hoisted(() => ({
  importTable: vi.fn(),
  finish: { current: (_value: unknown) => {} },
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    importTable: (body: unknown) => {
      importTable(body);
      return new Promise((resolve) => {
        finish.current = resolve;
      });
    },
  },
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: {
    list: () =>
      Promise.resolve({
        items: [
          {
            id: "t-1",
            title: "Personal CRM with a very long table name",
            columnCount: 2,
          },
        ],
      }),
    get: () =>
      Promise.resolve({
        columns: [{ id: "col-name", name: "Name", type: "text" }],
      }),
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportContactsDialog onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("ImportContactsDialog", () => {
  it("shows a pending state and stays open until the import finishes", async () => {
    const { onClose } = renderDialog();
    fireEvent.click(
      await screen.findByLabelText(/Personal CRM with a very long table name/),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/^fields\.name/)).toHaveTextContent("Name"),
    );
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(importTable).toHaveBeenCalledWith({
      tableId: "t-1",
      mapping: { name: "col-name" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("importing");
    expect(screen.getByRole("button", { name: "cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "submit" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByLabelText(/Personal CRM with a very long table name/),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onClose).not.toHaveBeenCalled();

    finish.current({
      created: 3,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      listsCreated: 0,
    });
    expect(
      await screen.findByRole("button", { name: "done" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
