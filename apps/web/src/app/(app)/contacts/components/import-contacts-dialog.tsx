"use client";
import type { ContactImportResult } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import {
  coreErrorOf,
  guessImportMapping,
  IMPORT_FIELDS,
  type ImportField,
} from "@/app/contacts/contacts-view";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { contactsService } from "@/lib/services/contacts.client";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { refreshContacts } from "./use-contacts-data";

const SKIP = "__skip";

/** Import people from a Files table: pick it, map its columns, run. */
export function ImportContactsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("App.Contacts.importDialog");
  const cache = useQueryClient();
  const [tableId, setTableId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>(
    {},
  );
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const tables = useQuery({
    queryKey: ["contacts-import-tables"],
    queryFn: () => dataTableService.list({ archived: "false" }),
  });
  const table = useQuery({
    enabled: !!tableId,
    queryKey: ["contacts-import-table", tableId],
    queryFn: () => dataTableService.get(tableId as string),
  });
  const columns =
    table.data?.columns.filter((column) => column.type !== "last_updated") ??
    [];

  function chooseTable(id: string) {
    setTableId(id);
    setError("");
    void cache
      .fetchQuery({
        queryKey: ["contacts-import-table", id],
        queryFn: () => dataTableService.get(id),
      })
      .then((data) => setMapping(guessImportMapping(data.columns)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tableId || !mapping.name) {
      setError(t("nameRequired"));
      return;
    }
    setPending(true);
    setError("");
    try {
      const summary = await contactsService.importTable({
        tableId,
        mapping: { ...mapping, name: mapping.name },
      });
      setResult(summary);
      await refreshContacts(cache);
    } catch (caught) {
      setError(coreErrorOf(caught).message ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        showCloseButton={!pending}
        className="app-scrollbar max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      >
        <form onSubmit={handleSubmit} className="grid min-w-0 gap-5">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {result ? t("doneDescription") : t("description")}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <dl className="grid grid-cols-2 gap-3">
              {(["created", "updated", "unchanged", "skipped"] as const).map(
                (key) => (
                  <div key={key} className="rounded-lg border p-3">
                    <dt className="text-muted-foreground text-xs">
                      {t(`result.${key}`)}
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {result[key]}
                    </dd>
                  </div>
                ),
              )}
              {result.listsCreated ? (
                <p className="text-muted-foreground col-span-2 text-sm">
                  {t("result.listsCreated", { count: result.listsCreated })}
                </p>
              ) : null}
            </dl>
          ) : (
            <fieldset disabled={pending} className="grid min-w-0 gap-5">
              <fieldset className="grid min-w-0 gap-2">
                <legend className="mb-2 text-sm font-medium">
                  {t("chooseTable")}
                </legend>
                {tables.isPending ? (
                  <Skeleton className="h-20 w-full" />
                ) : tables.data?.items.length ? (
                  <div className="app-scrollbar grid max-h-48 grid-cols-1 gap-1 overflow-x-hidden overflow-y-auto">
                    {tables.data.items.map((item) => (
                      <label
                        key={item.id}
                        className={cn(
                          "has-focus-visible:ring-ring flex min-w-0 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-focus-visible:ring-2",
                          pending && "cursor-default",
                          tableId === item.id
                            ? "border-primary-tertiary bg-primary-quinary"
                            : "hover:bg-accent transition-colors",
                        )}
                      >
                        <input
                          type="radio"
                          name="import-table"
                          value={item.id}
                          checked={tableId === item.id}
                          onChange={() => chooseTable(item.id)}
                          className="sr-only"
                        />
                        <Table2
                          aria-hidden
                          className="text-muted-foreground size-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.title}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {t("columnCount", { count: item.columnCount })}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("noTables")}
                  </p>
                )}
              </fieldset>
              {tableId ? (
                <fieldset className="grid min-w-0 gap-2">
                  <legend className="mb-1 text-sm font-medium">
                    {t("mapColumns")}
                  </legend>
                  <p className="text-muted-foreground mb-2 text-xs">
                    {t("mapHint")}
                  </p>
                  {table.isPending ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <div className="grid gap-2">
                      {IMPORT_FIELDS.map((field) => (
                        <div
                          key={field}
                          className="grid grid-cols-[1fr_1.4fr] items-center gap-3"
                        >
                          <Label
                            htmlFor={`import-${field}`}
                            className="font-normal"
                          >
                            {t(`fields.${field}`)}
                            {field === "name" ? (
                              <span className="text-muted-foreground">
                                {" "}
                                {t("required")}
                              </span>
                            ) : null}
                          </Label>
                          <Select
                            value={mapping[field] ?? SKIP}
                            onValueChange={(value) =>
                              setMapping((previous) => ({
                                ...previous,
                                [field]: value === SKIP ? undefined : value,
                              }))
                            }
                          >
                            <SelectTrigger
                              id={`import-${field}`}
                              size="sm"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP}>
                                {t("skipColumn")}
                              </SelectItem>
                              {columns.map((column) => (
                                <SelectItem key={column.id} value={column.id}>
                                  {column.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  )}
                </fieldset>
              ) : null}
            </fieldset>
          )}
          <div className="bg-background sticky -bottom-6 -mx-6 -mb-6 grid gap-3 px-6 pt-1 pb-6">
            {pending ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t("importing")}
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="text-semantic-destructive-label text-sm"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter>
              {result ? (
                <Button type="button" variant="primary" onClick={onClose}>
                  {t("done")}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={onClose}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={pending}
                    disabled={!tableId}
                  >
                    {t("submit")}
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
