"use client";

import type { TableColumn } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dataTableService } from "@/lib/services/data-table.client";
import {
  pastedTableRows,
  tableImportBatches,
  tableInsertRows,
} from "./table-import";
import { tableError } from "./table-value";

/**
 * Adds cells copied from a spreadsheet as new rows at the end of the table,
 * laid onto `columns` from the left. Opened from the toolbar, or from a cell
 * that received more than one cell, in which case `text` holds the paste.
 */
export function TablePasteDialog({
  tableId,
  columns,
  text: initialText,
  onClose,
  onAdded,
}: {
  tableId: string;
  columns: TableColumn[];
  text: string;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations("App.Tables");
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  // One key per pasted text: a retry after a failed batch replays the batches
  // that already landed instead of adding their rows twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  let parsed: ReturnType<typeof pastedTableRows> | null = null;
  let parseError = "";
  if (text.trim())
    try {
      parsed = pastedTableRows(columns, text);
    } catch (error) {
      parseError = tableError(error, t);
    }
  async function handleAdd() {
    if (!parsed) return;
    setPending(true);
    setError("");
    try {
      const offset = parsed.header ? 2 : 1;
      const rows = tableInsertRows(
        columns,
        parsed.rows,
        (index, error) =>
          new Error(`${t("row")} ${index + offset}: ${tableError(error, t)}`),
      );
      let added = 0;
      for (const batch of tableImportBatches(key, rows)) {
        await dataTableService.batch(tableId, batch);
        added += batch.insert.length;
        setProgress(added);
      }
      await onAdded();
      onClose();
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="app-scrollbar max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("pasteRows")}</DialogTitle>
          <DialogDescription>{t("pasteRowsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="table-paste-rows">{t("pasteCells")}</Label>
            <Textarea
              id="table-paste-rows"
              className="min-h-24 font-mono"
              placeholder={t("pastePlaceholder")}
              value={text}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value);
                setKey(crypto.randomUUID());
                setError("");
              }}
            />
          </div>
          {parsed && parsed.rows.length > 0 && (
            <div className="grid gap-2">
              <div className="app-scrollbar bg-card overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-card-background">
                    <tr className="border-b">
                      {columns.map((column) => (
                        <th
                          className="h-10 px-2 text-start font-medium whitespace-nowrap"
                          key={column.id}
                        >
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        {columns.map((column, i) => (
                          <td
                            className="max-w-48 truncate border-b p-2"
                            key={column.id}
                          >
                            {row[i]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground text-sm">
                {parsed.header && `${t("pasteHeaderSkipped")} `}
                {t("pastePreview", { count: parsed.rows.length })}
              </p>
            </div>
          )}
          {(error || parseError) && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="min-w-0 break-words">
                  {error || parseError}
                </span>
              </AlertDescription>
            </Alert>
          )}
          <p role="status" className="text-muted-foreground text-sm">
            {pending ? t("importProgress", { count: progress }) : null}
          </p>
        </div>
        <DialogFooter>
          <Button
            loading={pending}
            disabled={!parsed?.rows.length}
            onClick={() => void handleAdd()}
          >
            {t("addPastedRows", { count: parsed?.rows.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
