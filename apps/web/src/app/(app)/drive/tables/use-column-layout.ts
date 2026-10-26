"use client";
import type { DataTable } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { dataTableService } from "@/lib/services/data-table.client";
import type { ColumnLayout } from "./table-layout";
import { tableError } from "./table-value";

/** A resize settles for this long before it is saved, so one drag is one write. */
const SAVE_DELAY_MS = 500;

/**
 * Column widths and wrapping, shown at once and saved shortly after through
 * the table's own column update, so everyone on the table sees the same
 * layout. Local changes win over polled data until their save settles; a
 * failed save drops them, which puts the last saved layout back.
 */
export function useColumnLayout(table: DataTable) {
  const t = useTranslations("App.Tables");
  const cache = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, ColumnLayout>>({});
  const unsaved = useRef<Record<string, ColumnLayout>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const tableKey = ["data-table", table.id];

  /** The newest polled or saved copy: a save must carry the current version and column list. */
  function latestTable(): DataTable {
    return cache
      .getQueriesData<DataTable>({ queryKey: tableKey })
      .reduce(
        (latest, [, data]) =>
          data && data.version > latest.version ? data : latest,
        table,
      );
  }

  function settle(saved: Record<string, ColumnLayout>) {
    setOverrides((previous) => {
      const next = { ...previous };
      for (const [id, layout] of Object.entries(saved))
        if (
          next[id] &&
          (layout.width === undefined || next[id].width === layout.width) &&
          (layout.wrap === undefined || next[id].wrap === layout.wrap)
        )
          delete next[id];
      return next;
    });
  }

  async function save() {
    const batch = unsaved.current;
    unsaved.current = {};
    if (!Object.keys(batch).length) return;
    const latest = latestTable();
    try {
      const result = await dataTableService.update(table.id, {
        key: crypto.randomUUID(),
        version: latest.version,
        columns: latest.columns.map((column) => ({
          ...column,
          ...batch[column.id],
        })),
      });
      cache.setQueriesData<DataTable>({ queryKey: tableKey }, (previous) =>
        previous ? result : previous,
      );
    } catch (error) {
      toast.error(t("errors.layout", { reason: tableError(error, t) }));
      await cache.invalidateQueries({ queryKey: tableKey });
    } finally {
      settle(batch);
    }
  }

  function change(columnId: string, layout: ColumnLayout, delay = 0) {
    setOverrides((previous) => ({
      ...previous,
      [columnId]: { ...previous[columnId], ...layout },
    }));
    unsaved.current = {
      ...unsaved.current,
      [columnId]: { ...unsaved.current[columnId], ...layout },
    };
    clearTimeout(timer.current);
    // One save at a time: the next carries the version the last one returned.
    timer.current = setTimeout(() => {
      saving.current = saving.current.then(save);
    }, delay);
  }

  return {
    /** The column as it should render: polled data under any unsaved local change. */
    withLayout: <T extends { id: string }>(column: T): T & ColumnLayout => ({
      ...column,
      ...overrides[column.id],
    }),
    /** Shows a width mid-drag without saving it; `setWidth` saves the final one. */
    preview: (columnId: string, width: number) =>
      setOverrides((previous) => ({
        ...previous,
        [columnId]: { ...previous[columnId], width },
      })),
    setWidth: (columnId: string, width: number) =>
      change(columnId, { width }, SAVE_DELAY_MS),
    setWrap: (columnId: string, wrap: boolean) => change(columnId, { wrap }),
  };
}
