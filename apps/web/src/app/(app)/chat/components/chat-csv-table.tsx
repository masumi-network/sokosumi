"use client";

import { createContext, type ReactNode, useContext } from "react";

import { TableCreateDialog } from "@/app/drive/tables/table-create-dialog";
import { spreadsheetKind } from "@/lib/spreadsheet-file";

/**
 * Where a CSV from this room becomes a Table: the active workspace, which
 * Core creates the Table in. `undefined` when the room is not that
 * workspace's own (an External channel hosted elsewhere, a Room visit,
 * ADR-0061), so its files never move to another workspace.
 */
const ChatCsvTableContext = createContext<string | null | undefined>(undefined);

export function ChatCsvTableWorkspace({
  workspaceId,
  children,
}: {
  workspaceId: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <ChatCsvTableContext.Provider value={workspaceId}>
      {children}
    </ChatCsvTableContext.Provider>
  );
}

/**
 * "Open as Table" for a CSV attachment: the Files CSV import, read from the
 * message's own file link, mapped and previewed before anything is created.
 */
export function ChatCsvTable({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const workspaceId = useContext(ChatCsvTableContext);
  if (workspaceId === undefined || spreadsheetKind("", fileName) !== "csv")
    return null;
  return (
    <TableCreateDialog
      workspaceId={workspaceId}
      csvFile={{ url, name: fileName }}
      labelled
    />
  );
}
