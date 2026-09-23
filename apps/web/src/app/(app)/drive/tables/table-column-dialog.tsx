"use client";
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
import { Textarea } from "@/components/ui/textarea";
import type { DataTable, TableColumn } from "@/lib/clients/generated/core";
import { dataTableService } from "@/lib/services/data-table.client";
import { TABLE_TYPES } from "./table-create-dialog";
import { isTableRejection } from "./table-mutations";
import { tableError } from "./table-value";
export function TableColumnDialog({
  table,
  column,
  onClose,
  onSaved,
}: {
  table: DataTable;
  column?: TableColumn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("App.Tables");
  const [baseTable, setBaseTable] = useState(table);
  const [latestTable, setLatestTable] = useState<DataTable>();
  const [name, setName] = useState(column?.name ?? "");
  const [description, setDescription] = useState(column?.description ?? "");
  const [type, setType] = useState<TableColumn["type"]>(column?.type ?? "text");
  const [options, setOptions] = useState(column?.options?.join("; ") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reviewConflict, setReviewConflict] = useState(false);
  const [request, setRequest] =
    useState<Parameters<typeof dataTableService.update>[1]>();
  const [columnId] = useState(() => column?.id ?? crypto.randomUUID());
  async function reloadLatest() {
    setLatestTable(undefined);
    setPending(true);
    try {
      const latest = await dataTableService.get(table.id);
      setBaseTable(latest);
      setLatestTable(latest);
      setError("");
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  async function handleSave() {
    setPending(true);
    try {
      const next = {
        id: columnId,
        name,
        description,
        type,
        options: options
          .split(";")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const body = request ?? {
        key: crypto.randomUUID(),
        version: baseTable.version,
        columns: column
          ? baseTable.columns.map((item) =>
              item.id === column.id ? next : item,
            )
          : [...baseTable.columns, next],
      };
      setRequest(body);
      await dataTableService.update(table.id, body);
      onSaved();
      onClose();
    } catch (error) {
      if (isTableRejection(error)) {
        setRequest(undefined);
        if (
          error &&
          typeof error === "object" &&
          "error" in error &&
          error.error === "Conflict"
        ) {
          setReviewConflict(true);
          await reloadLatest();
        }
      }
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !pending && !request) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{column ? t("editColumn") : t("addColumn")}</DialogTitle>
          <DialogDescription>{t("columnDescription")}</DialogDescription>
        </DialogHeader>
        {reviewConflict && (
          <div role="alert" className="grid gap-2 rounded-md border p-3">
            <p className="text-sm">{t("columnConflictReview")}</p>
            <ul className="text-muted-foreground grid gap-1 text-sm">
              {latestTable?.columns.map((item) => (
                <li key={item.id}>
                  {item.name} · {t(`types.${item.type}`)}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void reloadLatest()}
              >
                {t("reloadLatest")}
              </Button>
              <Button
                type="button"
                disabled={pending || !latestTable}
                onClick={() => setReviewConflict(false)}
              >
                {t("reviewLatest")}
              </Button>
            </div>
          </div>
        )}
        <fieldset
          disabled={pending || !!request || reviewConflict}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="column-name">{t("columnName")}</Label>
            <Input
              id="column-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="column-description">{t("description")}</Label>
            <Textarea
              id="column-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="column-type">{t("type")}</Label>
            <select
              id="column-type"
              className="bg-background rounded-md border px-3 py-2 text-sm"
              value={type}
              onChange={(event) =>
                setType(event.target.value as TableColumn["type"])
              }
            >
              {TABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </div>
          {type.includes("select") && (
            <div className="grid gap-2">
              <Label htmlFor="column-options">{t("options")}</Label>
              <Input
                id="column-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </fieldset>
        <DialogFooter>
          <Button
            onClick={() => void handleSave()}
            disabled={pending || reviewConflict}
          >
            {pending ? t("saving") : request ? t("retry") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
