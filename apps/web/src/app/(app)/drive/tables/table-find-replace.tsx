"use client";
import type { DataTable, TableRow } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dataTableService } from "@/lib/services/data-table.client";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { createTableMutations } from "./table-mutations";
import { parseTableInput, tableError } from "./table-value";

/** One batch writes at most this many rows, and one batch is one undo. */
const LIMIT = 100;

/** Replaces one exact cell value with another across a table, as one undoable batch. */
export function TableFindReplace({
  table,
  onClose,
  onDone,
}: {
  table: DataTable;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("App.Tables");
  const columns = table.columns.filter(
    (column) => column.type !== "last_updated",
  );
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [found, setFound] = useState<{ rows: TableRow[]; total: number }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mutate] = useState(createTableMutations);
  const column = columns.find((item) => item.id === columnId);
  const locked = mutate.hasPending();

  function edit(set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setFound(undefined);
      setError("");
    };
  }
  async function handleFind() {
    if (!column) return;
    setError("");
    try {
      const value = parseTableInput(column, find);
      parseTableInput(column, replace);
      setPending(true);
      const page = await dataTableService.query(table.id, {
        filters: [{ columnId, operator: "equals", value }],
        limit: LIMIT,
        archived: false,
      });
      setFound({ rows: page.rows, total: page.total ?? page.rows.length });
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  async function handleApply() {
    if (!column || !found) return;
    setPending(true);
    setError("");
    try {
      const value = parseTableInput(column, replace);
      await mutate(
        "find-replace",
        {
          patch: found.rows.map((row) => ({
            id: row.id,
            version: row.version,
            values: { [columnId]: value },
          })),
        },
        (body) => dataTableService.batch(table.id, body),
      );
      onDone(found.rows.length);
      onClose();
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  const tooMany = !!found && found.total > LIMIT;
  const ready = !!found && found.total > 0 && !tooMany;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !locked) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("findReplace.title")}</DialogTitle>
          <DialogDescription>{t("findReplace.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void (ready ? handleApply() : handleFind());
          }}
        >
          <fieldset disabled={pending || locked} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="find-replace-column">
                {t("findReplace.column")}
              </Label>
              <select
                id="find-replace-column"
                className={withEditableTextSize(
                  "bg-background h-10 rounded-md border px-3 py-2",
                )}
                value={columnId}
                onChange={(event) => edit(setColumnId)(event.target.value)}
              >
                {columns.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="find-replace-find">{t("findReplace.find")}</Label>
              <Input
                id="find-replace-find"
                value={find}
                required
                autoComplete="off"
                onChange={(event) => edit(setFind)(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="find-replace-replace">
                {t("findReplace.replace")}
              </Label>
              <Input
                id="find-replace-replace"
                value={replace}
                autoComplete="off"
                placeholder={t("findReplace.replaceEmpty")}
                onChange={(event) => edit(setReplace)(event.target.value)}
              />
            </div>
          </fieldset>
          <p role="status" aria-live="polite" className="text-sm empty:hidden">
            {found &&
              (found.total === 0
                ? t("findReplace.none")
                : tooMany
                  ? t("findReplace.tooMany", {
                      count: found.total,
                      limit: LIMIT,
                    })
                  : t("findReplace.matches", { count: found.total }))}
          </p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" loading={pending} disabled={!find.trim()}>
              {ready
                ? t("findReplace.apply", { count: found.total })
                : t("findReplace.findMatches")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
