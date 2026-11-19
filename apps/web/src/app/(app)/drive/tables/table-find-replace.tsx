"use client";
import type { DataTable, TableRow } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { type RefObject, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { dataTableService } from "@/lib/services/data-table.client";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { createTableMutations } from "./table-mutations";
import { parseTableInput, tableError } from "./table-value";

/** One batch writes at most this many rows, and one batch is one undo. */
const LIMIT = 100;
/** Core refuses table requests over 1 MB. */
const MAX_BYTES = 1_000_000;
/** Columns whose cells hold one piece of text, so a whole-cell match is meaningful. */
const TEXT_TYPES = new Set(["text", "long_text", "url", "email"]);

type Patch = { id: string; version: number; values: TableRow["values"] };
type Found =
  | { kind: "none" }
  | { kind: "tooMany" }
  | { kind: "unchanged" }
  | { kind: "ready"; patch: Patch[] };

/** Replaces one cell value, matched whole and ignoring case, across a column as one undoable batch. */
export function TableFindReplace({
  table,
  returnFocus,
  onClose,
  onDone,
}: {
  table: DataTable;
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("App.Tables");
  const columns = table.columns.filter((column) => TEXT_TYPES.has(column.type));
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [found, setFound] = useState<Found>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mutate] = useState(createTableMutations);
  const column = columns.find((item) => item.id === columnId);
  const locked = mutate.hasPending();
  const Field = column?.type === "long_text" ? Textarea : Input;

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
    setPending(true);
    try {
      const value = parseTableInput(column, replace);
      const wanted = find.toLowerCase();
      const matches: TableRow[] = [];
      let cursor: string | undefined;
      // ponytail: Core has no case-insensitive whole-cell filter (its operators are
      // shared with Soko Bot's read_table), so read every `contains` hit and keep
      // whole-cell matches here. Up to 100 requests on a 10,000-row table.
      do {
        const page = await dataTableService.query(table.id, {
          filters: [{ columnId, operator: "contains", value: find }],
          limit: LIMIT,
          cursor,
          archived: false,
        });
        for (const row of page.rows) {
          const cell = row.values[columnId];
          if (typeof cell === "string" && cell.toLowerCase() === wanted)
            matches.push(row);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor && matches.length <= LIMIT);
      // A cell that already holds the replacement keeps its value and its sources.
      const patch = matches
        .filter((row) => row.values[columnId] !== value)
        .map((row) => ({
          id: row.id,
          version: row.version,
          values: { [columnId]: value },
        }));
      if (new Blob([JSON.stringify({ patch })]).size > MAX_BYTES) {
        setError(t("errors.requestSize"));
        return;
      }
      setFound(
        matches.length === 0
          ? { kind: "none" }
          : matches.length > LIMIT
            ? { kind: "tooMany" }
            : patch.length === 0
              ? { kind: "unchanged" }
              : { kind: "ready", patch },
      );
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  async function handleApply(patch: Patch[]) {
    setPending(true);
    setError("");
    try {
      await mutate("find-replace", { patch }, (body) =>
        dataTableService.batch(table.id, body),
      );
      onDone(patch.length);
      onClose();
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  const ready = found?.kind === "ready" ? found.patch : undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !locked) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("findReplace.title")}</DialogTitle>
          <DialogDescription>{t("findReplace.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void (ready ? handleApply(ready) : handleFind());
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
              <Field
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
              <Field
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
              (found.kind === "ready"
                ? t("findReplace.matches", { count: found.patch.length })
                : found.kind === "tooMany"
                  ? t("findReplace.tooMany", { limit: LIMIT })
                  : t(`findReplace.${found.kind}`))}
          </p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              loading={pending}
              disabled={!find.trim() || !column}
            >
              {ready
                ? t("findReplace.apply", { count: ready.length })
                : t("findReplace.findMatches")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
