"use client";

import { createContext, useContext } from "react";

import { TableCreateDialog } from "@/app/drive/tables/table-create-dialog";
import { spreadsheetKind } from "@/lib/spreadsheet-file";

/**
 * Where a CSV from this room becomes a Table: the active workspace, which
 * Core creates the Table in. Not provided on a Room visit (ADR-0061), whose
 * files belong to another workspace.
 */
const ChatCsvTableContext = createContext<{
  workspaceId: string | null;
} | null>(null);

export const ChatCsvTableWorkspace = ChatCsvTableContext.Provider;

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
  const destination = useContext(ChatCsvTableContext);
  if (!destination || spreadsheetKind("", fileName) !== "csv") return null;
  return (
    <TableCreateDialog
      workspaceId={destination.workspaceId}
      csvFile={{ url, name: fileName }}
    />
  );
}
