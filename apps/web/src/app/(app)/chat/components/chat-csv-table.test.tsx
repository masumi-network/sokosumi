import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/drive/tables/table-create-dialog", () => ({
  TableCreateDialog: ({
    workspaceId,
    sourceFile,
  }: {
    workspaceId: string | null;
    sourceFile: { url: string; name: string };
  }) => (
    <button type="button" data-workspace={workspaceId ?? "personal"}>
      Open as Table {sourceFile.name} {sourceFile.url}
    </button>
  ),
}));

import { ChatCsvTable, ChatCsvTableWorkspace } from "./chat-csv-table";

const URL = "https://x.public.blob.vercel-storage.com/chat/leads.csv";

afterEach(cleanup);

describe("ChatCsvTable", () => {
  it("opens a chat CSV in the Table import of the room's workspace", () => {
    render(
      <ChatCsvTableWorkspace workspaceId="org-1">
        <ChatCsvTable url={URL} fileName="leads.csv" />
      </ChatCsvTableWorkspace>,
    );
    const button = screen.getByRole("button", {
      name: `Open as Table leads.csv ${URL}`,
    });
    expect(button.dataset.workspace).toBe("org-1");
  });

  it("keeps the personal workspace as the destination", () => {
    render(
      <ChatCsvTableWorkspace workspaceId={null}>
        <ChatCsvTable url={URL} fileName="leads.csv" />
      </ChatCsvTableWorkspace>,
    );
    expect(screen.getByRole("button").dataset.workspace).toBe("personal");
  });

  it("offers nothing outside a room of the active workspace", () => {
    render(<ChatCsvTable url={URL} fileName="leads.csv" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers nothing where the room is not the active workspace's own", () => {
    render(
      <ChatCsvTableWorkspace workspaceId={undefined}>
        <ChatCsvTable url={URL} fileName="leads.csv" />
      </ChatCsvTableWorkspace>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers nothing for other files", () => {
    render(
      <ChatCsvTableWorkspace workspaceId="org-1">
        <ChatCsvTable url={URL.replace(".csv", ".pdf")} fileName="leads.pdf" />
      </ChatCsvTableWorkspace>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
